/* FieldOps Demo â€” request-estimate modal */
(function () {
  'use strict';

  var API_INTAKE = '/api/intake';
  var API_AVAILABILITY = '/api/public/availability';
  var FALLBACK_EMAIL = 'hello@example.invalid';
  var Submission = window.FieldOpsDemoSubmission || null;
  var CALENDAR_MONTH_COUNT = 12;

  var MAIN_SERVICES = window.CCS_MODAL_SERVICES || [
    { id: 'service_windows', label: 'Window Cleaning', detail: 'windows' },
    { id: 'service_pressure', label: 'Pressure Washing / Soft Washing', detail: 'pressure' },
    { id: 'service_gutter', label: 'Gutter Cleaning', detail: 'gutter' },
    { id: 'service_caulk', label: 'Caulking / Sealing', detail: 'caulk' }
  ];

  var SERVICE_VALUES_BY_DETAIL = Object.freeze({
    windows: 'windows',
    pressure: 'pressure',
    gutter: 'gutter',
    caulk: 'caulk'
  });

  var SERVICE_VALUES_BY_ID = Object.freeze({
    service_windows: 'windows',
    service_pressure: 'pressure',
    service_gutter: 'gutter',
    service_caulk: 'caulk'
  });

  var selectedDate = null;
  var availabilityData = [];
  var currentViewDate = null;
  var availabilityByMonth = {};
  var availabilityRequestSeq = 0;
  var calendarLoadingMonthKey = '';
  var calendarVisibleMonthKey = '';
  var calendarMenuOpen = false;
  var calendarHorizonStart = null;
  var calendarHorizonEnd = null;
  var isAvailabilityReliable = false;
  var slotContainer = null;
  var allowNoPreference = true;

  var estimateModal, orderModal;
  var openEstimateBtn, openOrderBtn;
  var closeEstimateBtn, closeOrderBtn;
  var estForm, orderForm;
  var estFormWrap, orderFormWrap;
  var estSuccessEl, orderSuccessEl;
  var servicesContainer, detailPanel;
  var calendarContainer, totalDisplay, orderError, orderFormError;
  var estName, estPhone, estAddress, estError, estPermission;
  var orderName, orderPhone, orderEmail, orderAddress, orderCity, orderState, orderZip;
  var orderCustomerType, orderPhotoInput;
  var orderNotes, orderContactMethod, orderCallbackWindow, orderContactConsent;
  var orderPropertyResidential, orderPropertyCommercial;
  var dateStrip, dateNavPrev, dateNavNext;
  var activeModal = null;
  var lastFocusedElement = null;
  var quickAddressLookupTimer = null;
  var quickAddressMap = {};

  function byId(id) { return document.getElementById(id); }
  function trim(v) { return (v || '').trim(); }
  function digits(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d;
  }
  function isValidPhone(v) { return digits(v).length === 10; }
  function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim(v)); }
  function normalizePhone(v) {
    var d = digits(v);
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    return trim(v);
  }
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function slugify(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function isValidState(v) { return /^[A-Za-z]{2}$/.test(trim(v)); }
  function isValidZip(v) { return /^\d{5}(?:-\d{4})?$/.test(trim(v)); }
  function getMonthLabel(dateStr) {
    var p = dateStr.split('-');
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]))
      .toLocaleDateString('en-US', { month: 'long' });
  }

  function inferModalPropertyType() {
    var path = String((window.location && window.location.pathname) || '').toLowerCase();
    if (path.indexOf('/commercial') !== -1) return 'Commercial';
    if (path.indexOf('/residential') !== -1) return 'Residential';

    var allCommercial = MAIN_SERVICES.length && MAIN_SERVICES.every(function (svc) {
      return /commercial/i.test(String(svc && svc.label));
    });
    if (allCommercial) return 'Commercial';

    return 'Not specified';
  }

  function modalStateCode(value) {
    var cleaned = trim(value).toUpperCase();
    var map = { WISCONSIN: 'WI', ILLINOIS: 'IL' };
    return map[cleaned] || cleaned.slice(0, 2) || 'WI';
  }

  function parseQuickAddress(value) {
    var raw = trim(value);
    var parts = raw.split(',').map(function (part) { return trim(part); }).filter(Boolean);
    var parsed = { line1: raw, city: '', state: '', zip: '' };
    if (parts.length >= 2) {
      parsed.line1 = parts[0];
      parsed.city = parts[1];
      var stateZip = parts.slice(2).join(' ');
      var match = stateZip.match(/\b([A-Za-z]{2}|Wisconsin|Illinois)\b\s*(\d{5}(?:-\d{4})?)?/i);
      if (match) {
        parsed.state = modalStateCode(match[1]);
        parsed.zip = match[2] || '';
      }
    } else {
      var inline = raw.match(/^(.*?)(?:\s+)([A-Za-z .'-]+),?\s+([A-Za-z]{2}|Wisconsin|Illinois)\s+(\d{5}(?:-\d{4})?)$/i);
      if (inline) {
        parsed.line1 = trim(inline[1]);
        parsed.city = trim(inline[2]);
        parsed.state = modalStateCode(inline[3]);
        parsed.zip = inline[4];
      }
    }
    return parsed;
  }

  function applyQuickAddressSuggestion(suggestion) {
    if (!suggestion || !orderAddress) return;
    orderAddress.value = trim(suggestion.address_line1 || suggestion.label);
    if (orderCity) orderCity.value = trim(suggestion.city) || 'Manual entry';
    if (orderState) orderState.value = modalStateCode(suggestion.state || 'WI');
    if (orderZip) orderZip.value = trim(suggestion.postal_code) || '00000';
  }

  function queueQuickAddressLookup() {
    if (!orderAddress) return;
    var query = trim(orderAddress.value);
    if (quickAddressLookupTimer) window.clearTimeout(quickAddressLookupTimer);
    if (query.length < 5) return;
    quickAddressLookupTimer = window.setTimeout(function () {
      fetch('/api/address-search?q=' + encodeURIComponent(query), { headers: { Accept: 'application/json' } })
        .then(function (response) { return response.ok ? response.json() : { results: [] }; })
        .then(function (data) {
          var list = byId('ord_address_suggestions');
          if (!list) return;
          quickAddressMap = {};
          list.innerHTML = (data.results || []).slice(0, 5).map(function (item) {
            var label = trim(item.label || item.display_name);
            if (!label) return '';
            quickAddressMap[label] = item;
            return '<option value="' + escapeHtml(label) + '"></option>';
          }).join('');
        })
        .catch(function () {
          quickAddressMap = {};
        });
    }, 240);
  }

  function handleQuickAddressChange() {
    var value = trim(orderAddress && orderAddress.value);
    if (quickAddressMap[value]) applyQuickAddressSuggestion(quickAddressMap[value]);
  }

  function generateFallbackDays(count) {
    count = count || 20;
    var arr = [];
    var d = new Date();
    while (arr.length < count) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        arr.push({
          date: y + '-' + m + '-' + day,
          display: d.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
          }),
          dayName: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
          dayNumber: String(d.getDate()),
          monthName: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
          slots: {
            am: { label: '9:00 AM', available: true },
            pm: { label: '12:00 PM', available: true }
          }
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return arr;
  }

  function fetchAvailability(startStr, days) {
    return fetch(
      API_AVAILABILITY
      + '?start=' + encodeURIComponent(startStr)
      + '&days=' + encodeURIComponent(days),
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }
    ).then(function (res) {
      if (!res.ok) throw new Error('Availability API error');
      return res.json();
    });
  }

  function openModal(modal) {
    if (!modal) return;
    modal.removeAttribute('hidden');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    var firstInput = modal.querySelector('input:not([type=hidden]), select, textarea, button');
    if (firstInput) firstInput.focus();
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) {
      document.body.style.overflow = '';
    }
  }

  function clearDetailPanel() {
    if (detailPanel) detailPanel.innerHTML = '';
  }

  function setOrderError(msg) {
    if (!orderError) return;
    orderError.textContent = msg;
    orderError.hidden = !msg;
  }

  function updateTotalMessage() {
    if (!totalDisplay) return;
    var any = servicesContainer
      ? servicesContainer.querySelectorAll('input.service-checkbox:checked').length
      : 0;
    totalDisplay.textContent = any
      ? 'Estimate will be reviewed after request.'
      : 'Select services to request an estimate.';
  }

  function createYesNoSelect(name) {
    var sel = document.createElement('select');
    sel.name = name;
    sel.className = 'modal-select';
    sel.innerHTML = '<option value="yes">Yes</option><option value="no" selected>No</option><option value="unsure">Not sure</option>';
    return sel;
  }

  function makeInput(type, id, className, attrs) {
    var el = document.createElement('input');
    el.type = type;
    if (id) el.id = id;
    if (className) el.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { el[k] = attrs[k]; });
    }
    return el;
  }

  function makeLabel(className, forAttr, text) {
    var lbl = document.createElement('label');
    if (className) lbl.className = className;
    if (forAttr) lbl.setAttribute('for', forAttr);
    if (text) lbl.textContent = text;
    return lbl;
  }

  function makeRow(labelText, labelFor, input) {
    var wrap = document.createElement('div');
    wrap.className = 'detail-row';
    var lbl = makeLabel('detail-label', labelFor, labelText);
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return wrap;
  }

  function renderMainServices() {
    if (!servicesContainer) return;
    servicesContainer.innerHTML = '';

    MAIN_SERVICES.forEach(function (svc) {
      var div = document.createElement('div');
      div.className = 'service-item';

      var info = document.createElement('div');
      info.className = 'service-info';

      var cb = makeInput('checkbox', 'chk_' + svc.id, 'service-checkbox');
      cb.setAttribute('data-service', svc.id);
      cb.addEventListener('change', function () {
        updateDetailPanel();
        updateTotalMessage();
      });

      var label = makeLabel('', cb.id, svc.label);
      info.appendChild(cb);
      info.appendChild(label);
      div.appendChild(info);
      servicesContainer.appendChild(div);
    });

    var trustNote = document.createElement('p');
    trustNote.className = 'trust-sentence';
    trustNote.textContent = 'We honor estimates when the job matches the details you submit.';
    servicesContainer.appendChild(trustNote);

    updateTotalMessage();
  }

  function updateDetailPanel() {
    if (!detailPanel) return;
    detailPanel.innerHTML = '';

    var checked = {};
    MAIN_SERVICES.forEach(function (svc) {
      var cb = byId('chk_' + svc.id);
      checked[svc.id] = cb && cb.checked;
    });

    if (checked.service_windows) {
      var winDiv = document.createElement('div');
      winDiv.className = 'detail-section';
      winDiv.innerHTML = '<h3>Window Cleaning</h3>';

      var levelWrap = document.createElement('div');
      levelWrap.className = 'detail-row';
      var levelP = document.createElement('p');
      levelP.className = 'detail-label';
      levelP.textContent = 'Service level:';
      levelWrap.appendChild(levelP);
      var opt1 = document.createElement('label');
      opt1.className = 'check-item';
      opt1.innerHTML = '<input type="radio" name="winServiceLevel" value="both" checked> <span>Inside &amp; Outside</span>';
      var opt2 = document.createElement('label');
      opt2.className = 'check-item';
      opt2.innerHTML = '<input type="radio" name="winServiceLevel" value="ext"> <span>Outside Only</span>';
      levelWrap.appendChild(opt1);
      levelWrap.appendChild(opt2);
      winDiv.appendChild(levelWrap);

      var countInput = makeInput('number', 'winCount', 'modal-input', { min: 1, placeholder: 'e.g., 12' });
      winDiv.appendChild(makeRow('About how many windows?', 'winCount', countInput));

      var notSureLabel = document.createElement('label');
      notSureLabel.className = 'check-item';
      notSureLabel.style.marginTop = '4px';
      notSureLabel.innerHTML = '<input type="checkbox" id="winCountNotSure"> <span>I\'m not sure â€“ review needed</span>';
      winDiv.appendChild(notSureLabel);
      notSureLabel.querySelector('input').addEventListener('change', function (e) {
        countInput.disabled = e.target.checked;
        if (e.target.checked) countInput.value = '';
      });

      var floorsInput = makeInput('number', 'winFloors', 'modal-input', { min: 1, max: 3, value: 1 });
      winDiv.appendChild(makeRow('How many floors?', 'winFloors', floorsInput));

      var extras = [
        { label: 'Screens', name: 'screens' },
        { label: 'Tracks', name: 'tracks' },
        { label: 'Storm windows', name: 'storm_windows' },
        { label: 'Skylights', name: 'skylights' },
        { label: 'Hard water stains', name: 'hard_water' },
        { label: 'Paint / construction debris', name: 'paint_debris' }
      ];
      var extrasGrid = document.createElement('div');
      extrasGrid.className = 'extras-grid';
      extras.forEach(function (extra) {
        var row = document.createElement('div');
        row.className = 'extras-row';
        var lbl = document.createElement('span');
        lbl.className = 'extras-label';
        lbl.textContent = extra.label;
        row.appendChild(lbl);
        row.appendChild(createYesNoSelect(extra.name));
        extrasGrid.appendChild(row);
      });
      winDiv.appendChild(extrasGrid);
      detailPanel.appendChild(winDiv);
    }

    if (checked.service_pressure) {
      var pDiv = document.createElement('div');
      pDiv.className = 'detail-section';
      pDiv.innerHTML = '<h3>Pressure Washing / Soft Washing</h3>';

      var surfaceInput = makeInput('text', 'pressureSurfaceType', 'modal-input', { placeholder: 'e.g., siding, concrete, brick' });
      pDiv.appendChild(makeRow('Surface type', 'pressureSurfaceType', surfaceInput));

      var pWalls = makeInput('number', 'pressureWalls', 'modal-input', { min: 1, value: 1 });
      pDiv.appendChild(makeRow('Walls / sections', 'pressureWalls', pWalls));

      var pFloors = makeInput('number', 'pressureFloors', 'modal-input', { min: 1, value: 1 });
      pDiv.appendChild(makeRow('Floors', 'pressureFloors', pFloors));

      var softLabel = document.createElement('label');
      softLabel.className = 'check-item';
      softLabel.innerHTML = '<input type="checkbox" id="pressureSoftWash"> <span>Soft washing needed (low-pressure, safe for siding)</span>';
      pDiv.appendChild(softLabel);
      detailPanel.appendChild(pDiv);
    }

    if (checked.service_gutter) {
      var gDiv = document.createElement('div');
      gDiv.className = 'detail-section';
      gDiv.innerHTML = '<h3>Gutter Cleaning</h3>';

      var gWalls = makeInput('number', 'gutterWalls', 'modal-input', { min: 1, value: 1 });
      gDiv.appendChild(makeRow('Gutter runs / walls', 'gutterWalls', gWalls));

      var gFloors = makeInput('number', 'gutterFloors', 'modal-input', { min: 1, value: 1 });
      gDiv.appendChild(makeRow('Floors', 'gutterFloors', gFloors));

      var heavyLabel = document.createElement('label');
      heavyLabel.className = 'check-item';
      heavyLabel.innerHTML = '<input type="checkbox" id="gutterHeavyDebris"> <span>Heavy debris (leaves, compacted buildup)</span>';
      gDiv.appendChild(heavyLabel);
      detailPanel.appendChild(gDiv);
    }

    if (checked.service_caulk) {
      var cDiv = document.createElement('div');
      cDiv.className = 'detail-section detail-section-note';
      cDiv.innerHTML = '<p><strong>Caulking / Sealing</strong> â€” Quoted after on-site review. No additional details needed here.</p>';
      detailPanel.appendChild(cDiv);
    }
  }

  function getSelectedDayData() {
    return availabilityData.filter(function (day) {
      return day.date === selectedDate;
    })[0] || null;
  }

  function getSelectedSlot() {
    var radio = document.querySelector('input[name="slotTime"]:checked');
    return radio ? radio.value : null;
  }

  function getSelectedSlotKey() {
    var radio = document.querySelector('input[name="slotTime"]:checked');
    return radio ? trim(radio.getAttribute('data-slot-key')).toLowerCase() : null;
  }

  function hasNoPreferenceSelected() {
    return !!allowNoPreference;
  }

  function dayHasAvailableSlots(dayData) {
    if (!dayData || !dayData.slots) return false;
    return !!(
      dayData.slots.am && dayData.slots.am.available
      || dayData.slots.pm && dayData.slots.pm.available
    );
  }

  function initCalendar() {
    if (!calendarContainer) return;
    calendarContainer.innerHTML = '<p class="calendar-heading">Loading availability...</p>';
    selectedDate = null;
    slotContainer = null;
    calendarMenuOpen = false;
    availabilityByMonth = {};
    availabilityRequestSeq = 0;
    availabilityData = [];
    isAvailabilityReliable = false;
    currentViewDate = startOfMonth(getTodayLocal());
    calendarVisibleMonthKey = getMonthKey(currentViewDate);
    calendarLoadingMonthKey = calendarVisibleMonthKey;
    initializeCalendarHorizon(currentViewDate);
    renderCalendar();
    ensureVisibleMonthAvailability();
  }

  function isSelectedSlotAvailable() {
    var dayData = getSelectedDayData();
    var slotKey = getSelectedSlotKey();
    if (!dayData || !slotKey) return false;
    if (!isAvailabilityReliable) return true;
    if (!dayData.slots || !dayData.slots[slotKey]) return false;
    return !!dayData.slots[slotKey].available;
  }

  function showEstimateSuccess() {
    if (estForm) estForm.hidden = true;
    if (estSuccessEl) estSuccessEl.hidden = false;
  }

  function showOrderSuccess() {
    if (orderForm) orderForm.hidden = true;
    if (orderSuccessEl) orderSuccessEl.hidden = false;
  }

  function renderQuickOrderForm() {
    if (!orderForm) return;
    var inferredType = inferModalPropertyType();
    if (inferredType !== 'Commercial') inferredType = 'Residential';
    orderForm.innerHTML =
      '<div id="orderFormError" class="form-error-summary" role="alert" aria-live="assertive" hidden></div>' +
      '<fieldset class="detail-section quick-intake-fields">' +
        '<legend>Quick quote details</legend>' +
        '<div class="detail-row">' +
          '<label class="detail-label req" for="ord_name">Name</label>' +
          '<input class="form-input modal-input" type="text" id="ord_name" name="name" autocomplete="name" required />' +
        '</div>' +
        '<div class="detail-row">' +
          '<label class="detail-label" for="ord_phone">Phone</label>' +
          '<input class="form-input modal-input" type="tel" id="ord_phone" name="phone" autocomplete="tel" />' +
        '</div>' +
        '<div class="detail-row">' +
          '<label class="detail-label" for="ord_email">Email</label>' +
          '<input class="form-input modal-input" type="email" id="ord_email" name="email" autocomplete="email" />' +
        '</div>' +
        '<p class="field-error" id="ord_contact_error" hidden></p>' +
        '<div class="detail-row">' +
          '<label class="detail-label req" for="ord_address">Service Address</label>' +
          '<input class="form-input modal-input" type="text" id="ord_address" name="address" autocomplete="street-address" list="ord_address_suggestions" required />' +
          '<datalist id="ord_address_suggestions"></datalist>' +
          '<input type="hidden" id="ord_city" name="city" />' +
          '<input type="hidden" id="ord_state" name="state" value="WI" />' +
          '<input type="hidden" id="ord_zip" name="zip" />' +
        '</div>' +
        '<div class="detail-row">' +
          '<label class="detail-label req" for="ord_customer_type">Residential or Commercial</label>' +
          '<select class="form-input modal-input" id="ord_customer_type" name="customer_type" required>' +
            '<option value="Residential"' + (inferredType === 'Residential' ? ' selected' : '') + '>Residential</option>' +
            '<option value="Commercial"' + (inferredType === 'Commercial' ? ' selected' : '') + '>Commercial</option>' +
          '</select>' +
        '</div>' +
      '</fieldset>' +
      '<div class="detail-section snapshot-upload">' +
        '<label class="detail-label" for="ord_snapshot_photos">Snapshot Estimate Photos <span>(optional)</span></label>' +
        '<input class="form-input modal-input" type="file" id="ord_snapshot_photos" accept="image/*" multiple />' +
        '<p id="ord_snapshot_status">Attach up to 3 quick exterior photos for an expedited quote.</p>' +
      '</div>' +
      '<p class="guarantee-badge modal-guarantee">No-Hassle 48-Hour Re-Clean Guarantee</p>' +
      '<button type="submit" class="btn btn-primary" style="width:100%;margin-top:16px;" id="orderSubmitBtn">Get a Free Instant Estimate</button>' +
      '<p class="trust-sentence">By submitting, I agree FieldOps Demo may contact me by call or text about this request. Free estimate, no obligation.</p>';
  }

  function resetEstimateForm() {
    if (estName) estName.value = '';
    if (estPhone) estPhone.value = '';
    if (estAddress) estAddress.value = '';
    if (estPermission) estPermission.checked = false;
    if (estForm) estForm.hidden = false;
    if (estSuccessEl) estSuccessEl.hidden = true;
  }

  function resetOrderForm() {
    if (orderName) orderName.value = '';
    if (orderPhone) orderPhone.value = '';
    if (orderEmail) orderEmail.value = '';
    if (orderAddress) orderAddress.value = '';
    if (orderCity) orderCity.value = '';
    if (orderState) orderState.value = 'WI';
    if (orderZip) orderZip.value = '';
    if (orderPhotoInput) orderPhotoInput.value = '';
    if (orderNotes) orderNotes.value = '';

    MAIN_SERVICES.forEach(function (svc) {
      var cb = byId('chk_' + svc.id);
      if (cb) cb.checked = false;
    });

    selectedDate = null;
    currentViewDate = null;
    availabilityByMonth = {};
    availabilityRequestSeq = 0;
    calendarLoadingMonthKey = '';
    calendarVisibleMonthKey = '';
    calendarMenuOpen = false;
    calendarHorizonStart = null;
    calendarHorizonEnd = null;
    availabilityData = [];
    isAvailabilityReliable = false;
    slotContainer = null;
    allowNoPreference = true;
    if (calendarContainer) initCalendar();
    clearOrderErrors();

    if (orderForm) orderForm.hidden = false;
    if (orderSuccessEl) orderSuccessEl.hidden = true;
  }

  function setEstimateButtonBusy(busy) {
    if (!estForm) return;
    var btn = estForm.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'Sending...' : 'Request Callback';
  }

  function setOrderButtonBusy(busy) {
    if (!orderForm) return;
    var btn = orderForm.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'Sending...' : 'Get a Free Instant Estimate';
  }

  function submitEstimateViaApi(name, phone, addr) {
    if (!Submission || !Submission.submitCanonicalRequest) return Promise.resolve();
    var parsedAddress = parseQuickAddress(addr);
    var payload = Submission.buildSubmissionPayload({
      form_type: 'callback_modal',
      customer: {
        name: name,
        phone: phone,
        email: '',
        address_line1: parsedAddress.line1 || addr,
        city: parsedAddress.city || 'Manual entry',
        state: modalStateCode(parsedAddress.state || 'WI'),
        postal_code: parsedAddress.zip || '00000'
      },
      request: {
        services: ['Callback Request'],
        property_type: inferModalPropertyType(),
        frequency: 'Not specified',
        notes: 'Quick callback request - customer will discuss services by phone. Typed-only service address: ' + addr
      }
    });
    return Submission.submitCanonicalRequest(payload, { endpoint: API_INTAKE })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error_message || 'Submission failed');
      });
  }

  function submitOrderViaApi(details, summary) {
    if (!Submission || !Submission.submitCanonicalRequest) return Promise.resolve();
    var noPreference = hasNoPreferenceSelected();
    var includeStructuredRequestedTime = !noPreference && isAvailabilityReliable;
    var requestedDate = noPreference ? '' : selectedDate;
    var requestedSlot = noPreference ? '' : getSelectedSlotKey();
    var requestedSlotLabel = noPreference ? '' : getSelectedSlot();
    var payload = Submission.buildSubmissionPayload({
      form_type: 'calendar_modal',
      customer: {
        name: details.name,
        phone: details.phone,
        email: details.email,
        address_line1: details.address.line1,
        city: details.address.city,
        state: details.address.state,
        postal_code: details.address.zip,
        best_time_to_reach: '',
        preferred_contact_method: ''
      },
      request: {
        services: ['Window Cleaning and Exterior Cleaning Estimate'],
        property_type: details.customerType,
        customer_type: details.customerType,
        frequency: 'One-time',
        recurring_frequency: 'one_time',
        discount_applied: 0,
        notes: summary && summary.text ? summary.text : '',
        requested_date: includeStructuredRequestedTime ? requestedDate : '',
        requested_slot: includeStructuredRequestedTime ? requestedSlot : '',
        requested_slot_label: includeStructuredRequestedTime ? requestedSlotLabel : ''
      },
      customer_type: details.customerType,
      recurring_frequency: 'one_time',
      discount_applied: 0,
      uploaded_photos: details.uploadedPhotos || []
    });
    if (!includeStructuredRequestedTime && payload.request) {
      delete payload.request.requested_date;
      delete payload.request.requested_slot;
      delete payload.request.requested_slot_label;
    }
    return Submission.submitCanonicalRequest(payload, { endpoint: API_INTAKE })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error_message || 'Submission failed');
      });
  }

  function setEstimateError(msg) {
    if (!estError) return;
    estError.textContent = msg;
    estError.hidden = !msg;
  }

  function submitEstimateForm(event) {
    event.preventDefault();
    var name = trim(estName ? estName.value : '');
    var phone = trim(estPhone ? estPhone.value : '');
    var addr = trim(estAddress ? estAddress.value : '');
    if (!name || !phone || !addr || !isValidPhone(phone)) {
      setEstimateError('Please fill in your name, a valid 10-digit phone number, and your address.');
      return;
    }
    setEstimateError('');
    setEstimateButtonBusy(true);
    submitEstimateViaApi(name, phone, addr)
      .then(function () {
        showEstimateSuccess();
      })
      .catch(function () {
        setEstimateError('Could not send your request. Please call us at (555) 010-0000.');
      })
      .finally(function () {
        setEstimateButtonBusy(false);
      });
  }

  function submitOrderForm(event) {
    event.preventDefault();
    var details = validateOrderForm();
    if (!details) return;

    var requestedDate = hasNoPreferenceSelected() ? '' : selectedDate;
    var requestedSlotLabel = hasNoPreferenceSelected() ? '' : getSelectedSlot();
    var summary = buildOrderSummary(details.userNotes, requestedDate, requestedSlotLabel);
    setOrderError('');
    setOrderButtonBusy(true);

    collectOrderPhotos()
      .then(function (photos) {
        details.uploadedPhotos = photos;
        return submitOrderViaApi(details, summary);
      })
      .then(function () {
        showOrderSuccess();
      })
      .catch(function (err) {
        if (err && err.message) {
          setOrderError(err.message);
          return;
        }
        setOrderError('Could not send your request. Please try again or call (555) 010-0000.');
      })
      .finally(function () {
        setOrderButtonBusy(false);
      });
    return;

    var name = trim(orderName ? orderName.value : '');
    var phone = trim(orderPhone ? orderPhone.value : '');
    var addr = trim(orderAddress ? orderAddress.value : '');
    var city = trim(orderCity ? orderCity.value : '');
    var state = trim(orderState ? orderState.value : '');
    var zip = trim(orderZip ? orderZip.value : '');

    if (!name || !phone || !addr || !isValidPhone(phone)) {
      setOrderError('Please enter your name, a valid 10-digit phone number, and your address.');
      return;
    }
    if (!city) { setOrderError('Please enter the city.'); return; }
    if (!isValidState(state)) { setOrderError('Please enter a valid 2-letter state (e.g., WI).'); return; }
    if (!isValidZip(zip)) { setOrderError('Please enter a valid ZIP code.'); return; }
    if (!getSelectedMainServices().length) { setOrderError('Please select at least one service.'); return; }

    var winCb = byId('chk_service_windows');
    if (winCb && winCb.checked) {
      var winCountInput = byId('winCount');
      var notSureChecked = byId('winCountNotSure') && byId('winCountNotSure').checked;
      if (!notSureChecked && winCountInput && !trim(winCountInput.value)) {
        setOrderError('Please provide an approximate number of windows, or check "I\'m not sure".');
        return;
      }
      if (!validatePositiveInt('winFloors', 'Window cleaning floors')) return;
    }

    var presCb = byId('chk_service_pressure');
    if (presCb && presCb.checked) {
      if (!validatePositiveInt('pressureWalls', 'Walls/sections for pressure washing')) return;
      if (!validatePositiveInt('pressureFloors', 'Floors for pressure washing')) return;
    }

    var gutCb = byId('chk_service_gutter');
    if (gutCb && gutCb.checked) {
      if (!validatePositiveInt('gutterWalls', 'Gutter runs/walls')) return;
      if (!validatePositiveInt('gutterFloors', 'Gutter floors')) return;
    }

    if (!hasNoPreferenceSelected()) {
      if (!selectedDate) { setOrderError('Please pick a preferred appointment date or continue without a preferred time.'); return; }
      var selectedSlot = getSelectedSlot();
      if (!selectedSlot) { setOrderError('Please pick an available time slot or continue without a preferred time.'); return; }
      if (!isSelectedSlotAvailable()) { setOrderError('Please pick an available time slot.'); return; }
    }

    var summary = buildOrderSummary();
    setOrderError('');
    setOrderButtonBusy(true);

    submitOrderViaApi(summary, name, phone, addr, city, state, zip)
      .then(function () {
        showOrderSuccess();
      })
      .catch(function (err) {
        if (err && err.message) {
          setOrderError(err.message);
          return;
        }
        setOrderError('Could not send your request. Please try again or call (555) 010-0000.');
      })
      .finally(function () {
        setOrderButtonBusy(false);
      });
  }

  function ensureAddressFields() {
    if (!orderAddress) return;
    if (byId('ord_city')) {
      orderCity = byId('ord_city');
      orderState = byId('ord_state');
      orderZip = byId('ord_zip');
      return;
    }

    var container = document.createElement('div');
    container.className = 'address-detail';

    function createInput(placeholder, id, maxLen) {
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      input.id = id;
      input.className = 'form-input';
      if (maxLen) input.maxLength = maxLen;
      return input;
    }

    orderCity = createInput('City', 'orderCity');
    orderState = createInput('State (WI)', 'orderState', 2);
    orderZip = createInput('ZIP code', 'orderZip', 10);

    container.appendChild(orderCity);
    container.appendChild(orderState);
    container.appendChild(orderZip);

    var addressField = orderAddress.closest('.form-field') || orderAddress.parentNode;
    var after = addressField ? addressField.nextSibling : orderAddress.nextSibling;
    var parent = addressField ? addressField.parentNode : orderAddress.parentNode;
    if (after) {
      parent.insertBefore(container, after);
    } else {
      parent.appendChild(container);
    }
  }

  function focusableModalItems(modal) {
    if (!modal) return [];
    return Array.prototype.filter.call(
      modal.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (item) {
        return !item.hidden && (item.offsetWidth > 0 || item.offsetHeight > 0 || item === document.activeElement);
      }
    );
  }

  function openModal(modal, opener) {
    if (!modal) return;
    lastFocusedElement = opener || document.activeElement;
    activeModal = modal;
    modal.hidden = false;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    var title = modal.querySelector('.modal-title');
    if (title && !title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    window.setTimeout(function () {
      var target = title || focusableModalItems(modal)[0];
      if (target && typeof target.focus === 'function') target.focus();
    }, 0);
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    modal.hidden = true;
    if (activeModal === modal) {
      activeModal = null;
      document.body.style.overflow = '';
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
    }
  }

  function ensureOrderErrorNode(anchor, errorId, className) {
    var node = byId(errorId);
    if (node) return node;
    node = document.createElement('p');
    node.id = errorId;
    node.className = className || 'field-error';
    node.hidden = true;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(node, anchor.nextSibling);
    }
    return node;
  }

  function appendDescribedBy(el, id) {
    if (!el || !id) return;
    var current = trim(el.getAttribute('aria-describedby'));
    var parts = current ? current.split(/\s+/) : [];
    if (parts.indexOf(id) === -1) {
      parts.push(id);
      el.setAttribute('aria-describedby', parts.join(' ').trim());
    }
  }

  function removeDescribedBy(el, id) {
    if (!el || !id) return;
    var current = trim(el.getAttribute('aria-describedby'));
    if (!current) return;
    var parts = current.split(/\s+/).filter(function (part) { return part && part !== id; });
    if (parts.length) {
      el.setAttribute('aria-describedby', parts.join(' '));
    } else {
      el.removeAttribute('aria-describedby');
    }
  }

  function clearFieldError(el) {
    if (!el || !el.id) return;
    var errorId = el.id + '_error';
    var errorNode = byId(errorId);
    el.removeAttribute('aria-invalid');
    el.classList.remove('is-invalid');
    if (errorNode) {
      errorNode.textContent = '';
      errorNode.hidden = true;
    }
    removeDescribedBy(el, errorId);
  }

  function setFieldError(el, message) {
    if (!el || !el.id) return;
    var errorId = el.id + '_error';
    var errorNode = ensureOrderErrorNode(el, errorId, 'field-error');
    errorNode.textContent = message;
    errorNode.hidden = false;
    el.setAttribute('aria-invalid', 'true');
    el.classList.add('is-invalid');
    appendDescribedBy(el, errorId);
  }

  function setGroupError(errorId, message) {
    var node = byId(errorId);
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  }

  function clearGroupError(errorId) {
    var node = byId(errorId);
    if (!node) return;
    node.textContent = '';
    node.hidden = true;
  }

  function setOrderError(message) {
    if (!orderFormError) return;
    orderFormError.textContent = message;
    orderFormError.hidden = !message;
  }

  function clearOrderErrors() {
    setOrderError('');
    [orderName, orderPhone, orderEmail, orderAddress, orderCustomerType, orderNotes].forEach(clearFieldError);
    var contactError = byId('ord_contact_error');
    if (contactError) { contactError.textContent = ''; contactError.hidden = true; }
    clearGroupError('orderServiceList_error');
    clearGroupError('orderCalendar_error');
  }

  function serviceValueFor(svc) {
    if (svc.value) return trim(svc.value);
    if (svc.detail && SERVICE_VALUES_BY_DETAIL[svc.detail]) return SERVICE_VALUES_BY_DETAIL[svc.detail];
    if (SERVICE_VALUES_BY_ID[svc.id]) return SERVICE_VALUES_BY_ID[svc.id];
    return slugify(svc.label || svc.id || 'service');
  }

  function selectedServiceConfigs() {
    return MAIN_SERVICES.filter(function (svc) {
      var checkbox = byId('chk_' + svc.id);
      return !!(checkbox && checkbox.checked);
    });
  }

  function getSelectedMainServices() {
    return selectedServiceConfigs().map(function (svc) { return svc.label; });
  }

  function getSelectedMainServiceValues() {
    return selectedServiceConfigs().map(function (svc) { return serviceValueFor(svc); });
  }

  function hasSelectedService(detailOrId) {
    return selectedServiceConfigs().some(function (svc) {
      return svc.detail === detailOrId || svc.id === detailOrId;
    });
  }

  function createOrderSelect(id, options) {
    var select = document.createElement('select');
    select.id = id;
    select.className = 'form-input modal-input modal-select-input';
    options.forEach(function (opt) {
      var option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    });
    return select;
  }

  function createOrderRow(labelText, inputId, control, required) {
    var row = document.createElement('div');
    row.className = 'detail-row';
    var label = document.createElement('label');
    label.className = 'detail-label' + (required ? ' req' : '');
    label.setAttribute('for', inputId);
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(control);
    return row;
  }

  function renderMainServices() {
    if (!servicesContainer) return;
    servicesContainer.innerHTML = '';
    MAIN_SERVICES.forEach(function (svc) {
      var item = document.createElement('div');
      item.className = 'service-item';
      var info = document.createElement('div');
      info.className = 'service-info';
      var checkbox = makeInput('checkbox', 'chk_' + svc.id, 'service-checkbox', { value: serviceValueFor(svc) });
      checkbox.name = 'services';
      checkbox.value = serviceValueFor(svc);
      checkbox.addEventListener('change', function () {
        clearGroupError('orderServiceList_error');
        setOrderError('');
      });
      var label = makeLabel('', checkbox.id, svc.label);
      info.appendChild(checkbox);
      info.appendChild(label);
      item.appendChild(info);
      servicesContainer.appendChild(item);
    });
  }

  function bindDynamicDetailListeners() {
    if (!detailPanel) return;
    Array.prototype.forEach.call(detailPanel.querySelectorAll('input, select, textarea'), function (el) {
      var handler = function () {
        clearFieldError(el);
        clearGroupError('winServiceLevel_error');
        setOrderError('');
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
  }

  function bindBaseOrderListeners() {
    [orderName, orderNotes, orderAddress, orderCustomerType].forEach(function (el) {
      if (!el) return;
      var handler = function () { clearFieldError(el); setOrderError(''); };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    [orderPhone, orderEmail].forEach(function (el) {
      if (!el) return;
      var handler = function () {
        clearFieldError(orderPhone);
        clearFieldError(orderEmail);
        var contactError = byId('ord_contact_error');
        if (contactError) { contactError.textContent = ''; contactError.hidden = true; }
        setOrderError('');
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
  }

  function updateDetailPanel() {
    if (!detailPanel) return;
    detailPanel.innerHTML = '';

    if (hasSelectedService('windows')) {
      var winSection = document.createElement('div');
      winSection.className = 'detail-section';
      winSection.innerHTML = '<h3>Window Cleaning</h3>';

      var levelFieldset = document.createElement('fieldset');
      levelFieldset.className = 'detail-subgroup choice-fieldset';
      levelFieldset.id = 'windowServiceLevelGroup';
      levelFieldset.innerHTML =
        '<legend class="detail-label req">Window cleaning service level</legend>' +
        '<div class="choice-grid">' +
          '<label class="choice-option" for="win_service_both"><input type="radio" id="win_service_both" name="winServiceLevel" value="inside_outside" checked /><span>Inside + outside</span></label>' +
          '<label class="choice-option" for="win_service_ext"><input type="radio" id="win_service_ext" name="winServiceLevel" value="exterior_only" /><span>Exterior only</span></label>' +
          '<label class="choice-option" for="win_service_unsure"><input type="radio" id="win_service_unsure" name="winServiceLevel" value="not_sure" /><span>Not sure</span></label>' +
        '</div>' +
        '<p id="winServiceLevel_error" class="field-error group-error" hidden></p>';
      winSection.appendChild(levelFieldset);

      winSection.appendChild(createOrderRow('Approximate window count', 'winCountRange', createOrderSelect('winCountRange', [
        { value: '', label: 'Choose one' },
        { value: '1_10', label: '1-10' },
        { value: '11_20', label: '11-20' },
        { value: '21_35', label: '21-35' },
        { value: '36_50', label: '36-50' },
        { value: '50_plus', label: '50+' },
        { value: 'not_sure', label: 'Not sure' }
      ]), true));

      winSection.appendChild(createOrderRow('Stories or access', 'winStories', createOrderSelect('winStories', [
        { value: '', label: 'Choose one' },
        { value: '1_story', label: '1 story' },
        { value: '2_stories', label: '2 stories' },
        { value: '3_plus', label: '3+ stories' },
        { value: 'not_sure', label: 'Not sure' }
      ]), true));
      detailPanel.appendChild(winSection);
    }

    if (hasSelectedService('pressure')) {
      var pressureSection = document.createElement('div');
      pressureSection.className = 'detail-section';
      pressureSection.innerHTML = '<h3>Pressure Washing / Soft Washing</h3>';
      var surfaceInput = document.createElement('input');
      surfaceInput.type = 'text';
      surfaceInput.id = 'pressureSurfaceType';
      surfaceInput.className = 'form-input modal-input';
      surfaceInput.placeholder = 'Siding, concrete, patio, deck, or not sure';
      pressureSection.appendChild(createOrderRow('Main area or surface', 'pressureSurfaceType', surfaceInput, false));
      pressureSection.appendChild(createOrderRow('Stories or access', 'pressureStories', createOrderSelect('pressureStories', [
        { value: '', label: 'Choose one' },
        { value: '1_story', label: '1 story' },
        { value: '2_stories', label: '2 stories' },
        { value: '3_plus', label: '3+ stories' },
        { value: 'not_sure', label: 'Not sure' }
      ]), true));
      detailPanel.appendChild(pressureSection);
    }

    if (hasSelectedService('gutter')) {
      var gutterSection = document.createElement('div');
      gutterSection.className = 'detail-section';
      gutterSection.innerHTML = '<h3>Gutter Cleaning</h3>';
      gutterSection.appendChild(createOrderRow('Stories or access', 'gutterStories', createOrderSelect('gutterStories', [
        { value: '', label: 'Choose one' },
        { value: '1_story', label: '1 story' },
        { value: '2_stories', label: '2 stories' },
        { value: '3_plus', label: '3+ stories' },
        { value: 'not_sure', label: 'Not sure' }
      ]), true));
      detailPanel.appendChild(gutterSection);
    }

    if (hasSelectedService('caulk')) {
      var caulkSection = document.createElement('div');
      caulkSection.className = 'detail-section detail-section-note';
      caulkSection.innerHTML = '<p><strong>Caulking / sealing</strong> is quoted after a quick review on site or from photos.</p>';
      detailPanel.appendChild(caulkSection);
    }

    bindDynamicDetailListeners();
  }

  function selectedPropertyType() {
    var radio = orderForm ? orderForm.querySelector('input[name="property_type"]:checked') : null;
    return radio ? trim(radio.value) : '';
  }

  function setDefaultPropertyType() {
    var inferred = inferModalPropertyType();
    if (orderPropertyResidential) orderPropertyResidential.checked = inferred === 'Residential';
    if (orderPropertyCommercial) orderPropertyCommercial.checked = inferred === 'Commercial';
  }

  function updateSelectedSlotClasses() {
    if (!slotContainer) return;
    Array.prototype.forEach.call(slotContainer.querySelectorAll('.slot-radio-label'), function (label) {
      var input = label.querySelector('input[type="radio"]');
      label.classList.toggle('selected-slot', !!(input && input.checked));
    });
  }

  function createSlotRadio(slotKey, slotData) {
    var wrapper = document.createElement('div');
    wrapper.className = 'slot-option';
    var label = document.createElement('label');
    label.className = 'slot-radio-label';
    label.setAttribute('for', 'slot-' + slotKey);
    var input = makeInput('radio', 'slot-' + slotKey, '', {});
    input.name = 'slotTime';
    input.value = slotData.label;
    input.setAttribute('data-slot-key', slotKey);
    if (!slotData.available && isAvailabilityReliable) {
      input.disabled = true;
      label.classList.add('disabled-slot');
    }
    input.addEventListener('change', function () {
      clearGroupError('orderCalendar_error');
      setOrderError('');
      updateSelectedSlotClasses();
    });
    var span = document.createElement('span');
    span.textContent = slotData.label + (!slotData.available && isAvailabilityReliable ? ' - Unavailable' : '');
    label.appendChild(input);
    label.appendChild(span);
    wrapper.appendChild(label);
    return wrapper;
  }

  function createNoPreferenceToggle() {
    var wrap = document.createElement('div');
    wrap.className = 'calendar-preference-toggle';
    var checkbox = makeInput('checkbox', 'noPreferredTime', '', {});
    checkbox.checked = !!allowNoPreference;
    checkbox.addEventListener('change', function () {
      allowNoPreference = checkbox.checked;
      clearGroupError('orderCalendar_error');
      setOrderError('');
      renderSlotsForSelectedDay(getSelectedDayData());
    });
    var label = document.createElement('label');
    label.setAttribute('for', 'noPreferredTime');
    label.textContent = 'No preference â€” just reach out when you\'re ready';
    wrap.appendChild(checkbox);
    wrap.appendChild(label);
    return wrap;
  }

  function toISODateLocal(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function parseISODateLocal(iso) {
    var parts = String(iso || '').split('-');
    if (parts.length !== 3) return null;
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day)) return null;
    return new Date(year, month - 1, day);
  }

  function cloneLocalDate(date) {
    return date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : null;
  }

  function getTodayLocal() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function addMonths(date, count) {
    return new Date(date.getFullYear(), date.getMonth() + count, 1);
  }

  function getMonthKey(date) {
    if (date instanceof Date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0')
      ].join('-');
    }

    var value = String(date || '').trim();
    if (!value) return '';
    if (/^\d{4}-\d{2}$/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      var parsed = parseISODateLocal(value);
      return parsed ? getMonthKey(parsed) : '';
    }
    return '';
  }

  function getMonthDateFromKey(monthKey) {
    var parts = String(monthKey || '').split('-');
    if (parts.length !== 2) return null;
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    if (!isFinite(year) || !isFinite(month)) return null;
    return new Date(year, month - 1, 1);
  }

  function isSameMonth(left, right) {
    return !!(
      left
      && right
      && left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
    );
  }

  function formatMonthLabel(date) {
    return date.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });
  }

  function formatShortCalendarDate(date) {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatFullCalendarLabel(date) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function initializeCalendarHorizon(startDate) {
    var baseMonth = startOfMonth(startDate || getTodayLocal());
    calendarHorizonStart = cloneLocalDate(baseMonth);
    calendarHorizonEnd = endOfMonth(addMonths(baseMonth, CALENDAR_MONTH_COUNT - 1));
  }

  function getVisibleMonthOptions() {
    if (!calendarHorizonStart || !calendarHorizonEnd) initializeCalendarHorizon(getTodayLocal());
    var months = [];
    var index;
    for (index = 0; index < CALENDAR_MONTH_COUNT; index++) {
      var monthDate = addMonths(calendarHorizonStart, index);
      months.push({
        monthDate: monthDate,
        monthKey: getMonthKey(monthDate),
        label: formatMonthLabel(monthDate)
      });
    }
    return months;
  }

  function buildCalendarDayRecord(dateObj, isAvailable) {
    return normalizeCalendarDay({
      date: toISODateLocal(dateObj),
      display: formatShortCalendarDate(dateObj),
      slots: {
        am: { label: '9:00 AM', available: !!isAvailable },
        pm: { label: '12:00 PM', available: !!isAvailable }
      }
    });
  }

  function normalizeCalendarDay(day) {
    if (!day || typeof day !== 'object') return null;
    var dateObj = parseISODateLocal(day.date);
    if (!dateObj) return null;
    var slots = day.slots && typeof day.slots === 'object' ? day.slots : {};
    var am = slots.am && typeof slots.am === 'object' ? slots.am : {};
    var pm = slots.pm && typeof slots.pm === 'object' ? slots.pm : {};

    return {
      date: toISODateLocal(dateObj),
      display: String(day.display || formatShortCalendarDate(dateObj)),
      dayName: String(day.dayName || dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()),
      dayNumber: String(day.dayNumber || dateObj.getDate()),
      monthName: String(day.monthName || dateObj.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()),
      slots: {
        am: { label: String(am.label || '9:00 AM'), available: !!am.available },
        pm: { label: String(pm.label || '12:00 PM'), available: !!pm.available }
      }
    };
  }

  function buildMonthAvailabilityChunks(monthDate) {
    var chunks = [];
    var monthStart = startOfMonth(monthDate);
    var monthEnd = endOfMonth(monthDate);
    var cursor = cloneLocalDate(monthStart);

    while (cursor <= monthEnd) {
      var chunkStart = cloneLocalDate(cursor);
      var chunkEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 20);
      if (chunkEnd > monthEnd) chunkEnd = cloneLocalDate(monthEnd);
      chunks.push({
        start: toISODateLocal(chunkStart),
        days: Math.floor((chunkEnd.getTime() - chunkStart.getTime()) / 86400000) + 1
      });
      cursor = new Date(chunkEnd.getFullYear(), chunkEnd.getMonth(), chunkEnd.getDate() + 1);
    }

    return chunks;
  }

  function buildFallbackMonthRecord(monthDate) {
    var byDate = {};
    var days = [];
    var cursor = startOfMonth(monthDate);
    var monthEnd = endOfMonth(monthDate);

    while (cursor <= monthEnd) {
      var fallbackDay = buildCalendarDayRecord(cursor, true);
      byDate[fallbackDay.date] = fallbackDay;
      days.push(fallbackDay);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }

    return {
      status: 'ready',
      reliable: false,
      days: days,
      byDate: byDate
    };
  }

  function buildMonthRecord(monthDate, results) {
    var byDate = {};
    var cursor = startOfMonth(monthDate);
    var monthEnd = endOfMonth(monthDate);
    var reliable = true;

    while (cursor <= monthEnd) {
      var emptyDay = buildCalendarDayRecord(cursor, false);
      byDate[emptyDay.date] = emptyDay;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }

    results.forEach(function (result) {
      if (!result || result.availabilityReliable === false || !Array.isArray(result.days)) {
        reliable = false;
        return;
      }

      result.days.forEach(function (item) {
        var normalized = normalizeCalendarDay(item);
        if (!normalized) return;
        var dateObj = parseISODateLocal(normalized.date);
        if (!dateObj || !isSameMonth(dateObj, monthDate)) return;
        byDate[normalized.date] = normalized;
      });
    });

    if (!reliable) return null;

    var orderedDates = Object.keys(byDate).sort();
    return {
      status: 'ready',
      reliable: true,
      days: orderedDates.map(function (dateKey) { return byDate[dateKey]; }),
      byDate: byDate
    };
  }

  function getMonthRecord(monthKey) {
    var record = availabilityByMonth[monthKey];
    return record && record.status === 'ready' ? record : null;
  }

  function getDayRecord(monthRecord, dateObj) {
    if (!monthRecord || !monthRecord.byDate) return null;
    return monthRecord.byDate[toISODateLocal(dateObj)] || null;
  }

  function isInsideBookingHorizon(dateObj) {
    if (!calendarHorizonStart || !calendarHorizonEnd) initializeCalendarHorizon(getTodayLocal());
    return dateObj >= calendarHorizonStart && dateObj <= calendarHorizonEnd;
  }

  function isPastDate(dateObj) {
    return dateObj < getTodayLocal();
  }

  function isWeekend(dateObj) {
    var day = dateObj.getDay();
    return day === 0 || day === 6;
  }

  function isUnavailableFromLiveData(dateObj, options) {
    var monthRecord = options && options.monthRecord;
    if (!monthRecord || !monthRecord.reliable) return false;
    var dayData = getDayRecord(monthRecord, dateObj);
    return !dayData || !dayHasAvailableSlots(dayData);
  }

  function getDisabledReason(dateObj, options) {
    options = options || {};
    if (options.isGhost) return 'ghost-date';
    if (!isInsideBookingHorizon(dateObj)) return 'outside-horizon';
    if (isPastDate(dateObj)) return 'past-date';
    if (isWeekend(dateObj)) return 'weekend';
    if (isUnavailableFromLiveData(dateObj, options)) return 'live-unavailable';
    if (options.isLoading) return 'loading-unavailable';
    return null;
  }

  function isSelectableCalendarDate(dateObj, options) {
    return !getDisabledReason(dateObj, options);
  }

  function syncSelectedDateForVisibleMonth() {
    if (!currentViewDate) return;
    var monthKey = getMonthKey(currentViewDate);
    var monthRecord = getMonthRecord(monthKey);
    if (!monthRecord) return;

    if (selectedDate) {
      var selectedDateObj = parseISODateLocal(selectedDate);
      if (
        selectedDateObj
        && isSameMonth(selectedDateObj, currentViewDate)
        && isSelectableCalendarDate(selectedDateObj, { monthRecord: monthRecord, isLoading: false })
      ) {
        return;
      }
    }

    selectedDate = null;
    var cursor = startOfMonth(currentViewDate);
    var monthEnd = endOfMonth(currentViewDate);
    while (cursor <= monthEnd) {
      if (isSelectableCalendarDate(cursor, { monthRecord: monthRecord, isLoading: false })) {
        selectedDate = toISODateLocal(cursor);
        return;
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
  }

  function applyMonthAvailability(monthKey, monthRecord) {
    if (!currentViewDate || getMonthKey(currentViewDate) !== monthKey) return;
    calendarVisibleMonthKey = monthKey;
    calendarLoadingMonthKey = '';
    availabilityData = monthRecord.days.slice();
    isAvailabilityReliable = monthRecord.reliable;
    syncSelectedDateForVisibleMonth();
    renderCalendar();
  }

  function loadAvailabilityForMonth(monthKey) {
    var monthDate = getMonthDateFromKey(monthKey);
    if (!monthDate) return Promise.resolve(null);

    var requestSeq = ++availabilityRequestSeq;
    var chunks = buildMonthAvailabilityChunks(monthDate);
    availabilityByMonth[monthKey] = { status: 'loading' };
    calendarLoadingMonthKey = monthKey;

    return Promise.all(chunks.map(function (chunk) {
      return fetchAvailability(chunk.start, chunk.days);
    })).then(function (results) {
      var monthRecord = buildMonthRecord(monthDate, results) || buildFallbackMonthRecord(monthDate);
      if (requestSeq !== availabilityRequestSeq) return null;
      if (getMonthKey(currentViewDate) !== monthKey) return null;
      availabilityByMonth[monthKey] = monthRecord;
      applyMonthAvailability(monthKey, monthRecord);
      return monthRecord;
    }).catch(function () {
      var fallbackRecord = buildFallbackMonthRecord(monthDate);
      if (requestSeq !== availabilityRequestSeq) return null;
      if (getMonthKey(currentViewDate) !== monthKey) return null;
      availabilityByMonth[monthKey] = fallbackRecord;
      applyMonthAvailability(monthKey, fallbackRecord);
      return fallbackRecord;
    });
  }

  function ensureVisibleMonthAvailability() {
    if (!currentViewDate) return Promise.resolve(null);
    var monthKey = getMonthKey(currentViewDate);
    calendarVisibleMonthKey = monthKey;

    var cachedRecord = getMonthRecord(monthKey);
    if (cachedRecord) {
      calendarLoadingMonthKey = '';
      availabilityData = cachedRecord.days.slice();
      isAvailabilityReliable = cachedRecord.reliable;
      syncSelectedDateForVisibleMonth();
      renderCalendar();
      return Promise.resolve(cachedRecord);
    }

    calendarLoadingMonthKey = monthKey;
    availabilityData = [];
    isAvailabilityReliable = true;
    renderCalendar();
    return loadAvailabilityForMonth(monthKey);
  }

  function getMonthJumpMeta(monthDate) {
    var monthRecord = getMonthRecord(getMonthKey(monthDate));
    if (!monthRecord) return 'Check availability';
    if (!monthRecord.reliable) return 'Call to confirm';

    var cursor = startOfMonth(monthDate);
    var monthEnd = endOfMonth(monthDate);
    while (cursor <= monthEnd) {
      if (isSelectableCalendarDate(cursor, { monthRecord: monthRecord, isLoading: false })) {
        return formatShortCalendarDate(cursor);
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }

    return 'No weekday openings';
  }

  function createWeekdayHeaderRow() {
    var weekdayRow = document.createElement('div');
    weekdayRow.className = 'calendar-weekday-row';
    weekdayRow.setAttribute('aria-hidden', 'true');
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (label) {
      var cell = document.createElement('span');
      cell.className = 'calendar-weekday-cell';
      cell.textContent = label;
      weekdayRow.appendChild(cell);
    });
    return weekdayRow;
  }

  function createCalendarGridButton(dateObj, monthRecord, isLoadingMonth) {
    var iso = toISODateLocal(dateObj);
    var isGhost = !isSameMonth(dateObj, currentViewDate);
    var disabledReason = getDisabledReason(dateObj, {
      isGhost: isGhost,
      isLoading: !!isLoadingMonth,
      monthRecord: monthRecord
    });
    var button = document.createElement('button');
    var numberEl = document.createElement('span');

    button.type = 'button';
    button.className = 'day-btn';
    if (isGhost) button.classList.add('is-ghost');

    numberEl.className = 'day-number';
    numberEl.textContent = String(dateObj.getDate());
    button.appendChild(numberEl);

    button.setAttribute('role', 'option');
    button.setAttribute('aria-label', formatFullCalendarLabel(dateObj));
    button.setAttribute('aria-selected', selectedDate === iso && !disabledReason ? 'true' : 'false');
    button.setAttribute('aria-disabled', disabledReason ? 'true' : 'false');

    if (!isGhost) button.setAttribute('data-date', iso);
    if (selectedDate === iso && !disabledReason) button.classList.add('active');

    if (disabledReason) {
      button.disabled = true;
      button.tabIndex = -1;
      button.classList.add('day-disabled');
      button.setAttribute('data-disabled-reason', disabledReason);
      return button;
    }

    button.addEventListener('click', function () {
      selectedDate = iso;
      allowNoPreference = false;
      clearGroupError('orderCalendar_error');
      setOrderError('');
      renderCalendar();
    });

    return button;
  }

  function shouldUseCalendarTransitions() {
    return !!(
      calendarContainer
      && document.startViewTransition
      && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    );
  }

  function renderWithCalendarTransition(mode, renderFn) {
    if (!shouldUseCalendarTransitions()) {
      renderFn();
      return Promise.resolve();
    }

    calendarContainer.setAttribute('data-calendar-transition', mode || 'swap');
    var transition = document.startViewTransition(function () {
      renderFn();
    });
    return transition.finished
      .catch(function () {})
      .then(function () {
        if (calendarContainer) calendarContainer.removeAttribute('data-calendar-transition');
      });
  }

  function toggleCalendarMenu() {
    calendarMenuOpen = !calendarMenuOpen;
    renderCalendar();
  }

  function navigateToCalendarMonth(monthDate, transitionMode) {
    currentViewDate = startOfMonth(monthDate);
    calendarVisibleMonthKey = getMonthKey(currentViewDate);
    calendarMenuOpen = false;

    return renderWithCalendarTransition(transitionMode || 'swap', renderCalendar)
      .then(function () {
        return ensureVisibleMonthAvailability();
      });
  }

  function navigateToNextCalendarMonth() {
    if (!currentViewDate) return;
    var lastVisibleMonth = startOfMonth(calendarHorizonEnd);
    if (currentViewDate >= lastVisibleMonth) return;
    navigateToCalendarMonth(addMonths(currentViewDate, 1), 'forward');
  }

  function navigateToPreviousCalendarMonth() {
    if (!currentViewDate) return;
    if (currentViewDate <= calendarHorizonStart) return;
    navigateToCalendarMonth(addMonths(currentViewDate, -1), 'backward');
  }

  function renderSlotsForSelectedDay(dayData) {
    if (!slotContainer) return;
    slotContainer.innerHTML = '';
    if (!dayData) {
      var empty = document.createElement('p');
      empty.className = 'trust-sentence';
      empty.textContent = 'No appointment slots are available in this date range.';
      slotContainer.appendChild(empty);
      return;
    }
    ['am', 'pm'].forEach(function (slotKey) {
      var slotData = dayData.slots && dayData.slots[slotKey]
        ? dayData.slots[slotKey]
        : { label: slotKey.toUpperCase(), available: false };
      slotContainer.appendChild(createSlotRadio(slotKey, slotData));
    });
    if (!allowNoPreference) {
      var firstAvailable = slotContainer.querySelector('input[name="slotTime"]:not([disabled])');
      if (firstAvailable) {
        firstAvailable.checked = true;
      } else if (isAvailabilityReliable) {
        var full = document.createElement('p');
        full.className = 'trust-sentence fully-booked-message';
        full.textContent = 'This day is fully booked. Choose another day or continue without a preferred time.';
        slotContainer.appendChild(full);
      }
    }
    updateSelectedSlotClasses();
  }

  function renderCalendar() {
    if (!calendarContainer) return;
    calendarContainer.innerHTML = '';

    if (!currentViewDate) {
      currentViewDate = startOfMonth(getTodayLocal());
      initializeCalendarHorizon(currentViewDate);
    }

    var visibleMonthKey = getMonthKey(currentViewDate);
    var visibleMonthRecord = getMonthRecord(visibleMonthKey);
    var isLoadingMonth = calendarLoadingMonthKey === visibleMonthKey && !visibleMonthRecord;
    var monthOptions = getVisibleMonthOptions();
    var monthIndex = monthOptions.map(function (item) { return item.monthKey; }).indexOf(visibleMonthKey);
    var canGoPrev = monthIndex > 0;
    var canGoNext = monthIndex > -1 && monthIndex < monthOptions.length - 1;
    var monthStart = startOfMonth(currentViewDate);
    var gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - monthStart.getDay());
    var dayCount = monthStart.getDay() + endOfMonth(currentViewDate).getDate();
    var totalCells = dayCount > 35 ? 42 : 35;

    if (visibleMonthRecord) {
      availabilityData = visibleMonthRecord.days.slice();
      isAvailabilityReliable = visibleMonthRecord.reliable;
      syncSelectedDateForVisibleMonth();
    } else {
      availabilityData = [];
      isAvailabilityReliable = true;
    }

    calendarContainer.appendChild(createNoPreferenceToggle());
    if (visibleMonthRecord && !visibleMonthRecord.reliable) {
      var warning = document.createElement('p');
      warning.className = 'trust-sentence availability-warning';
      warning.setAttribute('role', 'status');
      warning.setAttribute('aria-live', 'polite');
      warning.textContent = 'Availability could not be confirmed online. Choose a preferred time and we will call to confirm, or continue without a preferred time.';
      calendarContainer.appendChild(warning);
    }

    var carousel = document.createElement('div');
    carousel.className = 'date-carousel';

    var navRow = document.createElement('div');
    navRow.className = 'date-nav-row';

    dateNavPrev = document.createElement('button');
    dateNavPrev.type = 'button';
    dateNavPrev.className = 'date-nav date-nav-prev';
    dateNavPrev.textContent = 'Previous';
    dateNavPrev.disabled = !canGoPrev;
    dateNavPrev.hidden = !canGoPrev;
    if (canGoPrev) dateNavPrev.addEventListener('click', navigateToPreviousCalendarMonth);

    var navStatus = document.createElement('div');
    navStatus.className = 'date-nav-status';
    var navMonthLabel = document.createElement('span');
    navMonthLabel.className = 'date-nav-label';
    navMonthLabel.textContent = formatMonthLabel(currentViewDate);
    navStatus.appendChild(navMonthLabel);

    var navActions = document.createElement('div');
    navActions.className = 'date-nav-actions';

    var jumpWrap = document.createElement('div');
    jumpWrap.className = 'month-jump';
    var jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.className = 'date-nav month-jump-toggle';
    jumpBtn.textContent = 'Jump to Month';
    jumpBtn.setAttribute('aria-haspopup', 'menu');
    jumpBtn.setAttribute('aria-expanded', calendarMenuOpen ? 'true' : 'false');
    jumpBtn.addEventListener('click', toggleCalendarMenu);
    jumpWrap.appendChild(jumpBtn);

    if (calendarMenuOpen) {
      var jumpMenu = document.createElement('div');
      jumpMenu.className = 'month-jump-menu';
      jumpMenu.setAttribute('role', 'menu');
      monthOptions.forEach(function (monthItem) {
        var menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'month-jump-item';
        if (monthItem.monthKey === visibleMonthKey) menuBtn.classList.add('active');
        menuBtn.setAttribute('role', 'menuitem');
        var labelEl = document.createElement('span');
        labelEl.className = 'month-jump-item-label';
        labelEl.textContent = monthItem.label;
        var metaEl = document.createElement('span');
        metaEl.className = 'month-jump-item-meta';
        metaEl.textContent = getMonthJumpMeta(monthItem.monthDate);
        menuBtn.appendChild(labelEl);
        menuBtn.appendChild(metaEl);
        menuBtn.addEventListener('click', function () {
          navigateToCalendarMonth(monthItem.monthDate, 'jump');
        });
        jumpMenu.appendChild(menuBtn);
      });
      jumpWrap.appendChild(jumpMenu);
    }
    navActions.appendChild(jumpWrap);

    dateNavNext = document.createElement('button');
    dateNavNext.type = 'button';
    dateNavNext.className = 'date-nav date-nav-next';
    dateNavNext.textContent = 'Next';
    dateNavNext.disabled = !canGoNext;
    dateNavNext.hidden = !canGoNext;
    if (canGoNext) dateNavNext.addEventListener('click', navigateToNextCalendarMonth);

    navRow.appendChild(dateNavPrev);
    navRow.appendChild(navStatus);
    navRow.appendChild(navActions);
    navRow.appendChild(dateNavNext);
    carousel.appendChild(navRow);
    carousel.appendChild(createWeekdayHeaderRow());

    dateStrip = document.createElement('div');
    dateStrip.className = 'date-strip';
    dateStrip.setAttribute('role', 'listbox');
    dateStrip.setAttribute('aria-label', 'Available dates');
    dateStrip.setAttribute('aria-busy', isLoadingMonth ? 'true' : 'false');

    var offset;
    for (offset = 0; offset < totalCells; offset++) {
      var dayDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + offset);
      dateStrip.appendChild(createCalendarGridButton(dayDate, visibleMonthRecord, isLoadingMonth));
    }

    carousel.appendChild(dateStrip);
    calendarContainer.appendChild(carousel);
    slotContainer = document.createElement('div');
    slotContainer.className = 'slots-wrapper';
    calendarContainer.appendChild(slotContainer);

    if (isLoadingMonth) {
      var loadingMessage = document.createElement('p');
      loadingMessage.className = 'trust-sentence';
      loadingMessage.setAttribute('role', 'status');
      loadingMessage.setAttribute('aria-live', 'polite');
      loadingMessage.textContent = 'Checking availability for ' + formatMonthLabel(currentViewDate) + '.';
      slotContainer.appendChild(loadingMessage);
    } else {
      renderSlotsForSelectedDay(getSelectedDayData());
    }

    var calendarError = document.createElement('p');
    calendarError.id = 'orderCalendar_error';
    calendarError.className = 'field-error group-error';
    calendarError.hidden = true;
    calendarContainer.appendChild(calendarError);
  }

  function selectedPropertyTypeLabel() {
    return selectedPropertyType() || 'Not specified';
  }

  function formatHumanValue(value) {
    var map = {
      inside_outside: 'Inside + outside',
      exterior_only: 'Exterior only',
      not_sure: 'Not sure',
      '1_10': '1-10',
      '11_20': '11-20',
      '21_35': '21-35',
      '36_50': '36-50',
      '50_plus': '50+',
      '1_story': '1 story',
      '2_stories': '2 stories',
      '3_plus': '3+ stories'
    };
    return map[value] || value;
  }

  function collectOrderDetails() {
    var details = { service_details: {}, lines: [] };
    if (hasSelectedService('windows')) {
      var windowLevel = trim((orderForm.querySelector('input[name="winServiceLevel"]:checked') || {}).value);
      var windowCount = trim((byId('winCountRange') || {}).value);
      var windowStories = trim((byId('winStories') || {}).value);
      details.service_details.window_cleaning = {
        service_level: windowLevel,
        window_count_range: windowCount,
        stories: windowStories
      };
      details.lines.push('Window cleaning service level: ' + formatHumanValue(windowLevel || 'not_sure'));
      details.lines.push('Approximate window count: ' + formatHumanValue(windowCount || 'not_sure'));
      details.lines.push('Window cleaning stories/access: ' + formatHumanValue(windowStories || 'not_sure'));
    }
    if (hasSelectedService('pressure')) {
      var pressureStories = trim((byId('pressureStories') || {}).value);
      var pressureSurface = trim((byId('pressureSurfaceType') || {}).value);
      details.service_details.pressure_washing = {
        stories: pressureStories,
        surface_type: pressureSurface
      };
      details.lines.push('Pressure washing stories/access: ' + formatHumanValue(pressureStories || 'not_sure'));
      if (pressureSurface) details.lines.push('Pressure washing area: ' + pressureSurface);
    }
    if (hasSelectedService('gutter')) {
      var gutterStories = trim((byId('gutterStories') || {}).value);
      details.service_details.gutter_cleaning = { stories: gutterStories };
      details.lines.push('Gutter cleaning stories/access: ' + formatHumanValue(gutterStories || 'not_sure'));
    }
    return details;
  }

  function buildOrderSummary(userNotes, requestedDate, requestedSlotLabel) {
    var lines = ['Services selected:', '- Window Cleaning and Exterior Cleaning Estimate'];
    if (requestedDate && requestedSlotLabel) {
      lines.push('Requested appointment: ' + requestedDate + ' ' + requestedSlotLabel);
    } else {
      lines.push('Requested appointment: No preference; please call to confirm.');
    }
    if (trim(userNotes)) lines.push('Customer notes: ' + trim(userNotes));
    return { text: lines.join('\n'), details: {} };
  }

  function validateOrderForm() {
    clearOrderErrors();
    var firstInvalid = null;
    var name = trim(orderName && orderName.value);
    var phone = trim(orderPhone && orderPhone.value);
    var email = trim(orderEmail && orderEmail.value);
    var rawAddress = trim(orderAddress && orderAddress.value);
    var parsedAddress = parseQuickAddress(rawAddress);
    var city = trim(orderCity && orderCity.value) || parsedAddress.city || 'Manual entry';
    var state = modalStateCode(trim(orderState && orderState.value) || parsedAddress.state || 'WI');
    var zip = trim(orderZip && orderZip.value) || parsedAddress.zip || '00000';
    var customerType = trim(orderCustomerType && orderCustomerType.value) || inferModalPropertyType() || 'Residential';

    if (!name) { setFieldError(orderName, 'Please enter your name.'); firstInvalid = firstInvalid || orderName; }
    if (!phone && !email) {
      var contactError = byId('ord_contact_error');
      if (contactError) {
        contactError.textContent = 'Please add a phone number or email so we can reach you.';
        contactError.hidden = false;
      }
      firstInvalid = firstInvalid || orderPhone;
    } else {
      if (phone && !isValidPhone(phone)) { setFieldError(orderPhone, 'Please enter a valid 10-digit phone number.'); firstInvalid = firstInvalid || orderPhone; }
      if (email && !isValidEmail(email)) { setFieldError(orderEmail, 'Please enter a valid email address.'); firstInvalid = firstInvalid || orderEmail; }
    }
    if (!rawAddress) { setFieldError(orderAddress, 'Please enter the service address.'); firstInvalid = firstInvalid || orderAddress; }
    if (!customerType) { setFieldError(orderCustomerType, 'Please choose residential or commercial.'); firstInvalid = firstInvalid || orderCustomerType; }
    if (orderCity) orderCity.value = city;
    if (orderState) orderState.value = state;
    if (orderZip) orderZip.value = zip;
    if (orderAddress && parsedAddress.line1 && parsedAddress.line1 !== rawAddress && parsedAddress.city) {
      orderAddress.value = parsedAddress.line1;
    }
    if (calendarContainer && !allowNoPreference) {
      if (!selectedDate) { setGroupError('orderCalendar_error', 'Please choose a preferred date or continue without a preferred time.'); firstInvalid = firstInvalid || calendarContainer; }
      else if (!getSelectedSlotKey()) { setGroupError('orderCalendar_error', 'Please choose an available time slot or continue without a preferred time.'); firstInvalid = firstInvalid || slotContainer; }
      else if (isAvailabilityReliable && !isSelectedSlotAvailable()) { setGroupError('orderCalendar_error', 'Please choose an available time slot.'); firstInvalid = firstInvalid || slotContainer; }
    }

    if (firstInvalid) {
      setOrderError('Please review the highlighted fields and try again.');
      if (typeof firstInvalid.focus === 'function') firstInvalid.focus();
      return null;
    }

    return {
      name: name,
      phone: normalizePhone(phone),
      email: email,
      customerType: customerType,
      address: {
        line1: trim(orderAddress && orderAddress.value) || parsedAddress.line1 || rawAddress,
        city: city,
        state: state,
        zip: zip
      },
      uploadedPhotos: [],
      userNotes: (selectedDate || city !== 'Manual entry')
        ? trim(orderNotes && orderNotes.value)
        : 'Typed-only service address: ' + rawAddress
    };
  }

  function compressOrderPhoto(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type || '')) {
        resolve(null);
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { resolve(null); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { resolve(null); };
        img.onload = function () {
          var maxSide = 800;
          var ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * ratio));
          canvas.height = Math.max(1, Math.round(img.height * ratio));
          var context = canvas.getContext('2d');
          if (!context) {
            resolve(null);
            return;
          }
          context.drawImage(img, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.5);
          if (dataUrl.length > 190000) dataUrl = canvas.toDataURL('image/jpeg', 0.38);
          if (dataUrl.length > 220000) {
            resolve(null);
            return;
          }
          resolve({
            name: trim(file.name).slice(0, 120),
            type: 'image/jpeg',
            size: dataUrl.length,
            data_url: dataUrl
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function collectOrderPhotos() {
    var files = Array.prototype.slice.call((orderPhotoInput && orderPhotoInput.files) || [], 0, 3);
    var status = byId('ord_snapshot_status');
    if (!files.length) return Promise.resolve([]);
    if (status) status.textContent = 'Compressing ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '...';
    return Promise.all(files.map(compressOrderPhoto)).then(function (photos) {
      var ready = photos.filter(Boolean);
      if (status) {
        status.textContent = ready.length
          ? ready.length + ' photo' + (ready.length === 1 ? '' : 's') + ' ready for review.'
          : 'Photos could not be compressed, but your request can still be sent.';
      }
      return ready;
    }).catch(function () {
      if (status) status.textContent = 'Photos could not be compressed, but your request can still be sent.';
      return [];
    });
  }

  function init() {
    estimateModal = byId('estimateModal');
    orderModal = byId('orderModal');
    openEstimateBtn = byId('openEstimateBtn');
    openOrderBtn = byId('openOrderBtn');
    closeEstimateBtn = byId('estimateClose');
    closeOrderBtn = byId('orderClose');
    estForm = byId('estimateForm');
    orderForm = byId('orderForm');
    if (orderForm) renderQuickOrderForm();
    estSuccessEl = byId('estimateSuccess');
    orderSuccessEl = byId('orderSuccess');
    servicesContainer = byId('orderServiceList');
    calendarContainer = byId('orderCalendar');
    totalDisplay = null;
    orderFormError = byId('orderFormError');
    orderError = orderFormError;

    estName = byId('est_name');
    estPhone = byId('est_phone');
    estAddress = byId('est_address');
    estError = byId('estimateErrorMsg');

    orderName = byId('ord_name');
    orderPhone = byId('ord_phone');
    orderEmail = byId('ord_email');
    orderAddress = byId('ord_address');
    orderCity = byId('ord_city');
    orderState = byId('ord_state');
    orderZip = byId('ord_zip');
    orderCustomerType = byId('ord_customer_type');
    orderPhotoInput = byId('ord_snapshot_photos');
    orderNotes = byId('ord_notes');

    if (!orderModal || !orderForm) return;

    if (calendarContainer) calendarContainer.innerHTML = '';
    bindBaseOrderListeners();
    if (orderAddress) {
      orderAddress.addEventListener('input', queueQuickAddressLookup);
      orderAddress.addEventListener('change', handleQuickAddressChange);
    }

    if (openEstimateBtn) {
      openEstimateBtn.addEventListener('click', function () {
        resetEstimateForm();
        openModal(estimateModal);
      });
    }

    if (openOrderBtn) {
      openOrderBtn.addEventListener('click', function () {
        resetOrderForm();
        openModal(orderModal);
      });
    }

    document.querySelectorAll('.js-open-order-modal').forEach(function (el) {
      el.addEventListener('click', function () {
        resetOrderForm();
        openModal(orderModal);
      });
    });

    if (closeEstimateBtn) {
      closeEstimateBtn.addEventListener('click', function () { closeModal(estimateModal); });
    }
    if (closeOrderBtn) {
      closeOrderBtn.addEventListener('click', function () { closeModal(orderModal); });
    }

    var closeEstSuccBtn = byId('estimateDoneBtn');
    if (closeEstSuccBtn) {
      closeEstSuccBtn.addEventListener('click', function () { closeModal(estimateModal); });
    }

    var closeOrdSuccBtn = byId('orderDoneBtn');
    if (closeOrdSuccBtn) {
      closeOrdSuccBtn.addEventListener('click', function () { closeModal(orderModal); });
    }

    if (estimateModal) {
      estimateModal.addEventListener('click', function (e) {
        if (e.target === estimateModal) closeModal(estimateModal);
      });
    }
    orderModal.addEventListener('click', function (e) {
      if (e.target === orderModal) closeModal(orderModal);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (estimateModal && estimateModal.classList.contains('active')) closeModal(estimateModal);
        if (orderModal.classList.contains('active')) closeModal(orderModal);
      }
    });

    if (estForm) estForm.addEventListener('submit', submitEstimateForm);
    orderForm.addEventListener('submit', submitOrderForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
