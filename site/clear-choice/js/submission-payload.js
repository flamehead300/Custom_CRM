(function () {
  'use strict';

  var EMPTY_WINDOW_COUNTS = Object.freeze({
    double_hung: 0,
    casement: 0,
    picture: 0,
    storm: 0,
    skylight: 0,
  });

  var EMPTY_EXTRAS = Object.freeze({
    screens: 0,
    tracks: 0,
    hard_water: false,
    paint_debris: false,
    ladder_work: false,
    manual_skylight_cleaning: false,
  });

  var EMPTY_ADDONS = Object.freeze({
    pressure_washing: { enabled: false, walls: 0 },
    gutter_cleaning: { enabled: false, walls: 0 },
    caulking: { enabled: false },
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function trimString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function numberValue(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function money(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
  }

  function cents(value) {
    return Math.round(numberValue(value, 0) * 100) / 100;
  }

  function countValue(value) {
    var parsed = Math.floor(numberValue(value, 0));
    return parsed > 0 ? parsed : 0;
  }

  function boolValue(value) {
    return value === true || value === 1 || value === '1';
  }

  function normalizeDiscount(value) {
    if (value === true) return 1;
    if (value === false || value === null || value === undefined || value === '') return 0;
    return cents(value);
  }

  function normalizeUploadedPhotos(values) {
    if (!Array.isArray(values)) return [];
    return values.slice(0, 3).map(function (photo) {
      if (!photo || typeof photo !== 'object') return null;
      var dataUrl = trimString(photo.data_url || photo.dataUrl || photo.base64);
      return {
        name: trimString(photo.name).slice(0, 120),
        type: trimString(photo.type || photo.mime_type).slice(0, 80),
        size: countValue(photo.size || dataUrl.length),
        data_url: dataUrl,
      };
    }).filter(function (photo) {
      return !!(photo && (photo.data_url || photo.name));
    });
  }

  function normalizeStringList(values) {
    if (!Array.isArray(values)) return [];
    return values.map(function (value) {
      return trimString(value);
    }).filter(Boolean);
  }

  function uniqueStrings(values) {
    return Array.from(new Set(normalizeStringList(values)));
  }

  function serviceLevelLabel(propertyType, serviceLevel) {
    if (serviceLevel === 'ext') {
      return propertyType === 'com' ? 'Commercial Exterior Only' : 'Exterior Only';
    }
    return propertyType === 'com' ? 'Commercial Inside + Outside' : 'Inside + Outside';
  }

  function propertyTypeLabel(propertyType) {
    if (propertyType === 'com') return 'Commercial';
    if (propertyType === 'res') return 'Residential';
    return trimString(propertyType);
  }

  function normalizeLineItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var label = trimString(item.label || item.lbl);
      if (!label) return null;
      return {
        label: label,
        amount: cents(item.amount !== undefined ? item.amount : item.amt),
        quote_only: !!(item.quote_only || item.quoteOnly || item.q === 1 || item.q === true),
        display_amount: trimString(item.display_amount || item.displayAmount),
      };
    }).filter(Boolean);
  }

  function emptyEstimate(propertyType, source) {
    return {
      source: trimString(source) || 'calculator_handoff',
      property_type: trimString(propertyType),
      package_level: '',
      package_label: '',
      package_customized: false,
      customer_type: '',
      recurring_frequency: 'One-time',
      discount_applied: 0,
      uploaded_photos: [],
      service_level: '',
      service_level_label: '',
      frequency: 'Not specified',
      floors: 0,
      total_windows: 0,
      window_counts: clone(EMPTY_WINDOW_COUNTS),
      extras: clone(EMPTY_EXTRAS),
      addons: clone(EMPTY_ADDONS),
      minimum_applied: false,
      estimate_total: 0,
      line_items: [],
      commercial: null,
      service_details: {},
    };
  }

  function normalizeWindowCounts(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      double_hung: countValue(raw.double_hung !== undefined ? raw.double_hung : raw.doubleHung),
      casement: countValue(raw.casement),
      picture: countValue(raw.picture),
      storm: countValue(raw.storm),
      skylight: countValue(raw.skylight),
    };
  }

  function normalizeExtras(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      screens: countValue(raw.screens),
      tracks: countValue(raw.tracks),
      hard_water: !!(raw.hard_water || raw.hardWater),
      paint_debris: !!(raw.paint_debris || raw.paintDebris),
      ladder_work: !!(raw.ladder_work || raw.ladderWork),
      manual_skylight_cleaning: !!(raw.manual_skylight_cleaning || raw.manualSkylightCleaning || raw.skylights),
    };
  }

  function normalizeAddons(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var pressure = raw.pressure_washing || raw.pressure || {};
    var gutter = raw.gutter_cleaning || raw.gutter || {};
    var caulking = raw.caulking || raw.caulk || {};
    return {
      pressure_washing: {
        enabled: !!pressure.enabled,
        walls: countValue(pressure.walls),
      },
      gutter_cleaning: {
        enabled: !!gutter.enabled,
        walls: countValue(gutter.walls),
      },
      caulking: {
        enabled: !!caulking.enabled,
      },
    };
  }

  function normalizeCommercialData(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var estimatedTotal = raw.estimatedTotal;
    if (estimatedTotal === undefined) estimatedTotal = raw.estimated_total;
    var propertyUseType = trimString(raw.propertyUseType || raw.property_use_type || raw.propertyType || raw.property_type);
    var normalized = {
      scope: trimString(raw.scope),
      propertyType: propertyUseType,
      propertyUseType: propertyUseType,
      frequency: trimString(raw.frequency),
      glassQuantityMode: trimString(raw.glassQuantityMode || raw.glass_quantity_mode),
      windowCount: countValue(raw.windowCount !== undefined ? raw.windowCount : raw.window_count),
      doors: countValue(raw.doors),
      glassSqftRange: trimString(raw.glassSqftRange || raw.glass_sqft_range),
      stories: trimString(raw.stories),
      serviceLevel: trimString(raw.serviceLevel || raw.service_level),
      accessMethod: trimString(raw.accessMethod || raw.access_method),
      accessNotes: trimString(raw.accessNotes || raw.access_notes),
      operatingConstraints: trimString(raw.operatingConstraints || raw.operating_constraints),
      preferredServiceTime: trimString(raw.preferredServiceTime || raw.preferred_service_time || raw.priority),
      priority: trimString(raw.priority),
      liftRequired: boolValue(raw.liftRequired || raw.lift_required),
      ropeAccessPossible: boolValue(raw.ropeAccessPossible || raw.rope_access_possible),
      roofAccessAvailable: boolValue(raw.roofAccessAvailable || raw.roof_access_available),
      anchorPointsKnown: boolValue(raw.anchorPointsKnown || raw.anchor_points_known),
      coiRequired: boolValue(raw.coiRequired || raw.coi_required),
      waterFedPolePossible: boolValue(raw.waterFedPolePossible || raw.water_fed_pole_possible),
      obstructionsPresent: boolValue(raw.obstructionsPresent || raw.obstructions_present),
      publicAccessConstraints: boolValue(raw.publicAccessConstraints || raw.public_access_constraints),
      siteWalkRequired: boolValue(raw.siteWalkRequired || raw.site_walk_required),
      constructionDebris: uniqueStrings(raw.constructionDebris || raw.construction_debris),
      temperedGlassAcknowledged: boolValue(raw.temperedGlassAcknowledged || raw.tempered_glass_acknowledged),
      turnoverDate: trimString(raw.turnoverDate || raw.turnover_date),
      manualReviewRequired: !!(raw.manualReviewRequired || raw.manual_review_required),
      reviewStatus: trimString(raw.reviewStatus || raw.review_status),
      reviewReason: trimString(raw.reviewReason || raw.review_reason),
      estimateBand: trimString(raw.estimateBand || raw.estimate_band),
      estimatedTotal: estimatedTotal === null || estimatedTotal === '' || estimatedTotal === undefined ? null : cents(estimatedTotal),
    };

    if (!normalized.scope
      && !normalized.propertyType
      && !normalized.frequency
      && !normalized.glassQuantityMode
      && !normalized.windowCount
      && !normalized.doors
      && !normalized.glassSqftRange
      && !normalized.reviewStatus
      && !normalized.estimateBand
      && normalized.estimatedTotal === null) {
      return null;
    }

    return normalized;
  }

  function normalizeServiceDetails(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var normalized = {};
    Object.keys(raw).forEach(function (key) {
      var item = raw[key];
      if (!item || typeof item !== 'object') return;
      var quoteMode = trimString(item.quote_mode || item.quoteMode);
      if (quoteMode !== 'exact' && quoteMode !== 'range' && quoteMode !== 'manual_review') {
        quoteMode = item.estimate_band || item.estimateBand ? 'range' : (item.estimated_total !== undefined || item.estimatedTotal !== undefined ? 'exact' : 'manual_review');
      }
      var estimatedTotal = item.estimated_total;
      if (estimatedTotal === undefined) estimatedTotal = item.estimatedTotal;
      normalized[key] = {
        enabled: item.enabled !== false,
        branch: trimString(item.branch),
        quote_mode: quoteMode,
        manual_review_required: !!(item.manual_review_required || item.manualReviewRequired || quoteMode === 'manual_review'),
        estimated_total: estimatedTotal === null || estimatedTotal === '' || estimatedTotal === undefined ? null : cents(estimatedTotal),
        estimate_band: trimString(item.estimate_band || item.estimateBand),
        inputs: item.inputs && typeof item.inputs === 'object' ? clone(item.inputs) : {},
      };
    });
    return normalized;
  }

  function normalizeEstimateData(raw, fallbackPropertyType, fallbackSource) {
    if (!raw || typeof raw !== 'object') return null;

    var propertyType = trimString(raw.property_type || raw.propertyType || fallbackPropertyType);
    var estimate = emptyEstimate(propertyType, raw.source || fallbackSource);
    var windowCounts = normalizeWindowCounts(raw.window_counts || raw.windowCounts || (raw.state && raw.state.windows));
    var extras = normalizeExtras(raw.extras || (raw.state && raw.state.extras));
    var addons = normalizeAddons(raw.addons || (raw.state && raw.state.addons));
    var totalWindows = countValue(raw.total_windows !== undefined ? raw.total_windows : raw.totalWindows);
    var serviceLevel = trimString(raw.service_level || raw.serviceLevel || (raw.state && raw.state.serviceLevel));

    estimate.property_type = propertyType;
    estimate.package_level = trimString(raw.package_level || raw.packageLevel);
    estimate.package_label = trimString(raw.package_label || raw.packageLabel);
    estimate.package_customized = !!(raw.package_customized || raw.packageCustomized);
    estimate.customer_type = trimString(raw.customer_type || raw.customerType);
    estimate.recurring_frequency = trimString(raw.recurring_frequency || raw.recurringFrequency || raw.frequency_key) || 'One-time';
    estimate.discount_applied = normalizeDiscount(raw.discount_applied !== undefined ? raw.discount_applied : raw.discountApplied);
    estimate.uploaded_photos = normalizeUploadedPhotos(raw.uploaded_photos || raw.uploadedPhotos);
    estimate.service_level = serviceLevel;
    estimate.service_level_label = trimString(
      raw.service_level_label || raw.serviceLevelLabel || raw.svcLevel || serviceLevelLabel(propertyType, serviceLevel)
    );
    estimate.frequency = trimString(raw.frequency || raw.freq) || 'Not specified';
    estimate.floors = countValue(raw.floors);
    estimate.window_counts = windowCounts;
    estimate.extras = extras;
    estimate.addons = addons;
    estimate.total_windows = totalWindows || Object.values(windowCounts).reduce(function (sum, value) {
      return sum + value;
    }, 0);
    estimate.minimum_applied = !!(raw.minimum_applied || raw.minApplied);
    estimate.estimate_total = cents(raw.estimate_total !== undefined ? raw.estimate_total : raw.estimate);
    estimate.line_items = normalizeLineItems(raw.line_items || raw.lineItems);
    estimate.commercial = normalizeCommercialData(raw.commercial);
    estimate.service_details = normalizeServiceDetails(raw.service_details || raw.serviceDetails);
    if (!estimate.customer_type) {
      estimate.customer_type = propertyTypeLabel(propertyType);
    }

    return estimate;
  }

  function buildEstimateFromCalculator(calcData, source) {
    if (!calcData || typeof calcData !== 'object') return null;
    var state = calcData.state || {};
    var windows = state.windows || {};
    var extras = state.extras || {};
    var addons = state.addons || {};

    return normalizeEstimateData({
      source: source || 'calculator_handoff',
      property_type: calcData.mode,
      service_level: state.serviceLevel,
      service_level_label: calcData.svcLevel,
      frequency: calcData.freq,
      floors: calcData.floors,
      total_windows: calcData.totalWindows,
      window_counts: {
        double_hung: windows.doubleHung,
        casement: windows.casement,
        picture: windows.picture,
        storm: windows.storm,
        skylight: windows.skylight,
      },
      extras: {
        screens: extras.screens,
        tracks: extras.tracks,
        hard_water: extras.hardWater,
        paint_debris: extras.paintDebris,
        ladder_work: extras.ladderWork,
        manual_skylight_cleaning: extras.skylights,
      },
      addons: {
        pressure_washing: addons.pressure,
        gutter_cleaning: addons.gutter,
        caulking: addons.caulk,
      },
      minimum_applied: calcData.minApplied,
      estimate_total: calcData.estimate,
      line_items: (calcData.lineItems || []).map(function (item) {
        return {
          label: item.lbl,
          amount: item.amt,
          quote_only: !!item.quoteOnly,
        };
      }),
    }, calcData.mode, source || 'calculator_handoff');
  }

  function parseLegacyEstimate(params, fallbackPropertyType) {
    if (!params || params.get('from_calc') !== '1') return null;
    var estimate = emptyEstimate(fallbackPropertyType, 'calculator_handoff');
    estimate.service_level = (params.get('svc') || '').indexOf('window-ext') >= 0 ? 'ext' : 'both';
    estimate.service_level_label = serviceLevelLabel(estimate.property_type, estimate.service_level);
    estimate.frequency = trimString(params.get('freq')) || 'Not specified';
    estimate.floors = countValue(params.get('floors'));
    estimate.total_windows = countValue(params.get('wins'));
    estimate.minimum_applied = params.get('calc_min') === '1';
    estimate.estimate_total = cents(params.get('est'));
    estimate.line_items = normalizeLineItems(JSON.parse(params.get('calc_items') || '[]'));
    return estimate;
  }

  function parseEstimateQuery(params, fallbackPropertyType) {
    if (!params || params.get('from_calc') !== '1') return null;

    var calc = params.get('calc');
    if (calc) {
      try {
        var parsed = normalizeEstimateData(JSON.parse(calc), fallbackPropertyType, 'calculator_handoff');
        if (parsed) return parsed;
      } catch (error) {
        console.warn('Unable to parse calc handoff payload.', error);
      }
    }

    try {
      return parseLegacyEstimate(params, fallbackPropertyType);
    } catch (error) {
      console.warn('Unable to parse legacy calc handoff payload.', error);
      return null;
    }
  }

  function deriveServicesFromEstimate(estimate) {
    if (!estimate) return [];

    var propertyType = trimString(estimate.property_type);
    var services = [];
    if (estimate.service_level === 'ext') {
      services.push(propertyType === 'com' ? 'Commercial Window Cleaning (Outside Only)' : 'Window Cleaning (Outside Only)');
    } else {
      services.push(propertyType === 'com' ? 'Commercial Window Cleaning (Inside/Outside)' : 'Window Cleaning (Inside and Outside)');
    }

    if (estimate.extras.screens > 0) services.push('Screen Cleaning');
    if (estimate.window_counts.storm > 0) services.push('Storm Windows');
    if (estimate.window_counts.skylight > 0 || estimate.extras.manual_skylight_cleaning) services.push('Skylights');
    if (estimate.addons.pressure_washing.enabled) {
      services.push(propertyType === 'com' ? 'Pavement & Concrete Pressure Washing' : 'Pressure Washing (Patio / Siding / Walkway)');
    }
    if (estimate.addons.gutter_cleaning.enabled) services.push('Gutter Cleaning');
    if (estimate.addons.caulking.enabled) services.push('Caulking / Sealing');

    return uniqueStrings(services);
  }

  function buildSubmissionPayload(config) {
    config = config && typeof config === 'object' ? config : {};
    var estimate = normalizeEstimateData(config.estimate, '', 'calculator_handoff');
    var request = config.request && typeof config.request === 'object' ? config.request : {};
    var commercial = normalizeCommercialData(config.commercial || (estimate && estimate.commercial));
    var serviceDetails = normalizeServiceDetails(config.service_details || config.serviceDetails || (estimate && estimate.service_details));
    var propertyTypeForCustomer = trimString(request.property_type || config.property_type || (estimate && estimate.property_type));
    var derivedCustomerType = propertyTypeLabel(propertyTypeForCustomer)
      || trimString(config.customer_type || request.customer_type || (estimate && estimate.customer_type));
    var payload = {
      form_type: trimString(config.form_type) || 'general',
      website: trimString(config.website || config.contact_url),
      customer: {
        name: trimString(config.customer && config.customer.name),
        phone: trimString(config.customer && config.customer.phone),
        email: trimString(config.customer && config.customer.email),
        address_line1: trimString(config.customer && config.customer.address_line1),
        city: trimString(config.customer && config.customer.city),
        state: trimString(config.customer && config.customer.state),
        postal_code: trimString(config.customer && config.customer.postal_code),
        best_time_to_reach: trimString(config.customer && config.customer.best_time_to_reach) || 'Not specified',
        preferred_contact_method: trimString(config.customer && config.customer.preferred_contact_method) || 'Not specified',
      },
      request: {
        services: uniqueStrings(request.services),
        property_type: trimString(request.property_type),
        customer_type: derivedCustomerType,
        frequency: trimString(request.frequency) || 'Not specified',
        recurring_frequency: trimString(request.recurring_frequency || config.recurring_frequency || (estimate && estimate.recurring_frequency)) || 'One-time',
        discount_applied: normalizeDiscount(request.discount_applied !== undefined ? request.discount_applied : (config.discount_applied !== undefined ? config.discount_applied : (estimate && estimate.discount_applied))),
        notes: trimString(request.notes),
        requested_date: trimString(request.requested_date),
        requested_slot: trimString(request.requested_slot).toLowerCase(),
        requested_slot_label: trimString(request.requested_slot_label),
      },
      estimate: estimate,
      package_level: trimString(config.package_level || (estimate && estimate.package_level)),
      package_label: trimString(config.package_label || (estimate && estimate.package_label)),
      package_customized: !!(config.package_customized || (estimate && estimate.package_customized)),
      customer_type: derivedCustomerType,
      recurring_frequency: trimString(config.recurring_frequency || request.recurring_frequency || (estimate && estimate.recurring_frequency)) || 'One-time',
      discount_applied: normalizeDiscount(config.discount_applied !== undefined ? config.discount_applied : (request.discount_applied !== undefined ? request.discount_applied : (estimate && estimate.discount_applied))),
      uploaded_photos: normalizeUploadedPhotos(config.uploaded_photos || (estimate && estimate.uploaded_photos)),
      commercial: commercial,
      service_details: serviceDetails,
    };

    if (payload.estimate) {
      payload.estimate.package_level = payload.estimate.package_level || payload.package_level;
      payload.estimate.package_label = payload.estimate.package_label || payload.package_label;
      payload.estimate.package_customized = payload.estimate.package_customized || payload.package_customized;
      payload.estimate.customer_type = payload.estimate.customer_type || payload.customer_type;
      payload.estimate.recurring_frequency = payload.estimate.recurring_frequency || payload.recurring_frequency;
      payload.estimate.discount_applied = payload.estimate.discount_applied || payload.discount_applied;
      payload.estimate.uploaded_photos = payload.estimate.uploaded_photos.length ? payload.estimate.uploaded_photos : payload.uploaded_photos;
      payload.estimate.commercial = payload.estimate.commercial || payload.commercial;
      payload.estimate.service_details = Object.keys(payload.estimate.service_details || {}).length ? payload.estimate.service_details : payload.service_details;
    }

    if (!payload.request.services.length && payload.estimate) {
      payload.request.services = deriveServicesFromEstimate(payload.estimate);
    }
    if (!payload.request.property_type && payload.estimate) {
      payload.request.property_type = propertyTypeLabel(payload.estimate.property_type);
    }
    if (!payload.request.customer_type) {
      payload.request.customer_type = payload.customer_type || payload.request.property_type;
    }
    if ((!payload.request.frequency || payload.request.frequency === 'Not specified') && payload.estimate) {
      payload.request.frequency = payload.estimate.frequency || 'Not specified';
    }
    if (!Object.keys(payload.service_details || {}).length) {
      delete payload.service_details;
    }
    if (!payload.commercial) {
      delete payload.commercial;
    }

    return payload;
  }

  function submissionTitle(formType) {
    switch (formType) {
      case 'residential':
        return 'NEW RESIDENTIAL ESTIMATE REQUEST';
      case 'commercial':
        return 'NEW COMMERCIAL ESTIMATE REQUEST';
      case 'calculator_modal':
        return 'NEW LIVE CALCULATOR ESTIMATE REQUEST';
      case 'callback_modal':
        return 'NEW ESTIMATE CALLBACK REQUEST';
      case 'calendar_modal':
        return 'NEW CALENDAR ESTIMATE REQUEST';
      default:
        return 'NEW ESTIMATE REQUEST';
    }
  }

  function submissionSource(formType) {
    switch (formType) {
      case 'residential':
        return 'residential';
      case 'commercial':
        return 'commercial';
      case 'calculator_modal':
        return 'calculator';
      case 'callback_modal':
        return 'modal-estimate-callback';
      case 'calendar_modal':
        return 'modal-estimate-calendar';
      default:
        return 'estimate';
    }
  }

  function buildEstimateEmailSubject(data) {
    var payload = buildSubmissionPayload(data);
    switch (payload.form_type) {
      case 'residential':
        return 'New Residential Estimate Request';
      case 'commercial':
        return 'New Commercial Estimate Request';
      case 'calculator_modal':
        return 'New Live Calculator Estimate Request';
      case 'callback_modal':
        return 'New Estimate Callback Request';
      case 'calendar_modal':
        return 'New Calendar Estimate Request';
      default:
        return 'New Estimate Request';
    }
  }

  function buildSubmissionSubject(payload) {
    return buildEstimateEmailSubject(payload);
  }

  function formatAddonSummary(addons) {
    var parts = [];
    if (addons.pressure_washing.enabled) {
      parts.push('Pressure washing (' + addons.pressure_washing.walls + ' wall' + (addons.pressure_washing.walls === 1 ? '' : 's') + ')');
    }
    if (addons.gutter_cleaning.enabled) {
      parts.push('Gutter cleaning (' + addons.gutter_cleaning.walls + ' wall' + (addons.gutter_cleaning.walls === 1 ? '' : 's') + ')');
    }
    if (addons.caulking.enabled) {
      parts.push('Caulking / Sealing');
    }
    return parts;
  }

  function buildSection(title, lines) {
    return ['--- ' + title + ' ---'].concat(lines);
  }

  function humanizeKey(key) {
    return trimString(key).replace(/_/g, ' ').replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function formatQuoteMode(detail) {
    if (!detail) return 'Not specified';
    if (detail.quote_mode === 'exact') {
      return detail.estimated_total === null ? 'Exact estimate' : 'Exact estimate: ' + money(detail.estimated_total);
    }
    if (detail.quote_mode === 'range') {
      return 'Estimate range: ' + (detail.estimate_band || 'Range pending');
    }
    return detail.manual_review_required ? 'Manual review required' : 'Review required';
  }

  function buildServiceDetailLines(serviceDetails) {
    serviceDetails = normalizeServiceDetails(serviceDetails);
    var keys = Object.keys(serviceDetails);
    if (!keys.length) return [];
    var lines = [];
    keys.forEach(function (key) {
      var detail = serviceDetails[key];
      if (!detail.enabled) return;
      lines.push(humanizeKey(key) + ': ' + (detail.branch || 'branch not specified') + ' / ' + formatQuoteMode(detail));
      var inputKeys = Object.keys(detail.inputs || {}).filter(function (inputKey) {
        var value = detail.inputs[inputKey];
        if (value === false || value === null || value === undefined || value === '') return false;
        if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return false;
        return true;
      });
      if (inputKeys.length) {
        lines.push('  Inputs: ' + inputKeys.map(function (inputKey) {
          var value = detail.inputs[inputKey];
          if (typeof value === 'object') {
            value = JSON.stringify(value);
          }
          return humanizeKey(inputKey) + '=' + value;
        }).join('; '));
      }
    });
    return lines;
  }

  function buildServiceLines(payload) {
    var lines = [
      'PROPERTY TYPE:     ' + (payload.request.property_type || 'Not specified'),
      'SERVICE FREQUENCY: ' + payload.request.frequency,
    ];

    if (payload.estimate) {
      lines.push('SERVICE LEVEL:     ' + (payload.estimate.service_level_label || 'Not specified'));
      lines.push((payload.commercial ? 'SCOPE:             ' : 'PACKAGE:           ') + (payload.estimate.package_label || 'Not specified'));
      if (!payload.commercial) {
        lines.push('PACKAGE CUSTOM:    ' + (payload.estimate.package_customized ? 'Yes' : 'No'));
      }
      lines.push('RECURRING OPTION:  ' + (payload.estimate.recurring_frequency || payload.request.recurring_frequency || 'One-time'));
      lines.push('DISCOUNT APPLIED:  ' + (payload.estimate.discount_applied ? payload.estimate.discount_applied + '% off' : 'No'));
    }

    if (payload.commercial) {
      lines.push('COMMERCIAL USE:    ' + (payload.commercial.propertyUseType || payload.commercial.propertyType || 'Not specified'));
      lines.push('SERVICE TIME:      ' + (payload.commercial.preferredServiceTime || 'No preference'));
      lines.push('OPERATING NOTES:   ' + (payload.commercial.operatingConstraints || 'Not specified'));
    }

    lines.push('SERVICES REQUESTED:');
    if (payload.request.services.length) {
      payload.request.services.forEach(function (service) {
        lines.push('  - ' + service);
      });
    } else {
      lines.push('  (none selected)');
    }

    return lines;
  }

  function buildEstimateLines(estimate) {
    if (!estimate) return [];
    var commercial = normalizeCommercialData(estimate.commercial);

    var lines = [
      'ROUTE SOURCE:   ' + (estimate.source || 'calculator_handoff'),
      'PROPERTY:       ' + (propertyTypeLabel(estimate.property_type) || 'Not specified'),
      'CUSTOMER TYPE:  ' + (estimate.customer_type || propertyTypeLabel(estimate.property_type) || 'Not specified'),
      'PACKAGE:        ' + (estimate.package_label || 'Not specified'),
      'PACKAGE CUSTOM: ' + (estimate.package_customized ? 'Yes' : 'No'),
      'SERVICE LEVEL: ' + (estimate.service_level_label || serviceLevelLabel(estimate.property_type, estimate.service_level)),
      'FREQUENCY:      ' + (estimate.frequency || 'Not specified'),
      'RECURRING:      ' + (estimate.recurring_frequency || 'One-time'),
      'DISCOUNT:       ' + (estimate.discount_applied ? estimate.discount_applied + '% off' : 'No'),
      'FLOORS:         ' + estimate.floors,
      'TOTAL WINDOWS:  ' + estimate.total_windows,
      'SCREENS:        ' + estimate.extras.screens,
      'TRACKS:         ' + estimate.extras.tracks,
      'SNAPSHOT PHOTOS:' + (estimate.uploaded_photos && estimate.uploaded_photos.length ? ' ' + estimate.uploaded_photos.length + ' attached' : ' none'),
    ];

    var windowParts = [];
    Object.keys(estimate.window_counts).forEach(function (key) {
      var value = estimate.window_counts[key];
      if (!value) return;
      windowParts.push(key.replace(/_/g, ' ') + ': ' + value);
    });
    if (windowParts.length) {
      lines.push('WINDOW COUNTS: ' + windowParts.join(', '));
    } else {
      lines.push('WINDOW COUNTS: none');
    }

    var adjustmentParts = [];
    if (estimate.extras.hard_water) adjustmentParts.push('Hard water');
    if (estimate.extras.paint_debris) adjustmentParts.push('Paint / debris');
    if (estimate.extras.ladder_work) adjustmentParts.push('Ladder work');
    if (estimate.extras.manual_skylight_cleaning) adjustmentParts.push('Manual skylight cleaning');
    if (adjustmentParts.length) {
      lines.push('ADJUSTMENTS:   ' + adjustmentParts.join(', '));
    } else {
      lines.push('ADJUSTMENTS:   none');
    }

    var addonParts = formatAddonSummary(estimate.addons);
    if (addonParts.length) {
      lines.push('ADD-ONS:       ' + addonParts.join(', '));
    } else {
      lines.push('ADD-ONS:       none');
    }

    if (commercial) {
      lines.push('COMMERCIAL SCOPE: ' + (commercial.scope || estimate.package_level || 'Not specified'));
      lines.push('PROPERTY USE:    ' + (commercial.propertyType || 'Not specified'));
      lines.push('GLASS MODE:      ' + (commercial.glassQuantityMode || 'Not specified'));
      lines.push('DOORS:           ' + commercial.doors);
      lines.push('SQ FT RANGE:     ' + (commercial.glassSqftRange || 'Not specified'));
      lines.push('ACCESS METHOD:   ' + (commercial.accessMethod || 'Not specified'));
      lines.push('ACCESS NOTES:    ' + (commercial.accessNotes || 'Not specified'));
      lines.push('OPERATING NOTES: ' + (commercial.operatingConstraints || 'Not specified'));
      if (commercial.constructionDebris.length) {
        lines.push('DEBRIS:          ' + commercial.constructionDebris.join(', '));
      }
      if (commercial.manualReviewRequired) {
        lines.push('STATUS:          ' + (commercial.reviewStatus === 'site_review' ? 'Site review required' : 'Manual review required'));
        lines.push('REVIEW REASON:   ' + (commercial.reviewReason || 'Access and safety requirements must be confirmed.'));
      } else if (commercial.estimateBand) {
        lines.push('ESTIMATE BAND:   ' + commercial.estimateBand);
      } else {
        lines.push('ESTIMATE TOTAL:  ' + money(commercial.estimatedTotal !== null ? commercial.estimatedTotal : estimate.estimate_total || 0));
      }
    } else {
      lines.push('ESTIMATE TOTAL: ' + money(estimate.estimate_total || 0));
      lines.push('MINIMUM:        ' + (estimate.minimum_applied ? 'Service minimum applied' : 'No'));
    }

    if (estimate.line_items.length) {
      lines.push('LINE ITEMS:');
      estimate.line_items.forEach(function (item) {
        lines.push('  - ' + item.label + '  ' + (item.display_amount || (item.quote_only ? 'Quoted separately' : money(item.amount))));
      });
    } else {
      lines.push('LINE ITEMS:');
      lines.push('  (none)');
    }

    var serviceDetailLines = buildServiceDetailLines(estimate.service_details);
    if (serviceDetailLines.length) {
      lines.push('SERVICE DETAILS:');
      serviceDetailLines.forEach(function (line) {
        lines.push('  - ' + line);
      });
    }

    return lines;
  }

  function buildEstimateEmailBody(data) {
    var payload = buildSubmissionPayload(data);
    var submittedAt = new Date().toISOString();

    var lines = [
      '=== ' + submissionTitle(payload.form_type) + ' ===',
      '',
      'FORM SOURCE: ' + submissionSource(payload.form_type),
      'SUBMITTED AT: ' + submittedAt,
    ];
    lines.push('');
    lines = lines.concat(buildSection('CUSTOMER INFO', [
      'ADDRESS:      ' + ([
        payload.customer.address_line1,
        payload.customer.city,
        payload.customer.state,
        payload.customer.postal_code,
      ].filter(Boolean).join(', ') || 'Not specified'),
      'NAME:         ' + (payload.customer.name || 'Not specified'),
      'PHONE:        ' + (payload.customer.phone || 'Not specified'),
      'EMAIL:        ' + (payload.customer.email || 'Not specified'),
      'CONTACT VIA:  ' + payload.customer.preferred_contact_method,
      'BEST TIME:    ' + payload.customer.best_time_to_reach,
    ]));
    lines.push('');
    lines = lines.concat(buildSection('PROPERTY / SERVICE INFO', buildServiceLines(payload)));

    if (payload.estimate) {
      lines.push('');
      lines = lines.concat(buildSection('CALCULATOR SUMMARY', buildEstimateLines(payload.estimate)));
    }

    var detailLines = buildServiceDetailLines(payload.service_details);
    if (detailLines.length) {
      lines.push('');
      lines = lines.concat(buildSection('SERVICE DETAIL BREAKDOWN', detailLines));
    }

    lines.push('');
    lines = lines.concat(buildSection('NOTES', [
      payload.request.notes || '(none)',
    ]));
    lines.push('');
    lines.push('=========================================');
    return lines.join('\n');
  }

  function buildSubmissionBody(payload) {
    return buildEstimateEmailBody(payload);
  }

  function buildSubmitErrorMessage(status, response) {
    var serverMessage = trimString(response && response.message);

    switch (status) {
      case 400:
        return serverMessage || 'Some required information is missing. Please review the form and try again.';
      case 415:
        return serverMessage || 'The request format was rejected. Please refresh the page and try again.';
      case 409:
        return serverMessage || 'That time was just taken. Please choose another available time.';
      case 429:
        return serverMessage || 'You have already submitted a recent request.';
      case 500:
      case 502:
      case 503:
        return serverMessage || 'Unable to send message right now.';
      default:
        return serverMessage || 'We could not send your request right now.';
    }
  }

  function formatRetryAfter(retryAfter) {
    var date = new Date(retryAfter);
    if (isNaN(date.getTime())) {
      date = new Date(Number(retryAfter) * 1000);
    }
    return isNaN(date.getTime()) ? 'a later date' : date.toLocaleDateString();
  }

  function readJsonResponse(res) {
    return res.json().catch(function () {
      return {};
    });
  }

  function normalizeNoticeOptions(options) {
    options = options && typeof options === 'object' ? options : {};
    return {
      google_form_url: trimString(options.google_form_url),
      google_form_label: trimString(options.google_form_label) || 'Google Form',
      fallback_email: trimString(options.fallback_email),
      call_label: trimString(options.call_label) || '(555)&nbsp;010-0000',
      call_href: trimString(options.call_href) || 'tel:+15550100000',
      rate_limit_tail: trimString(options.rate_limit_tail),
      error_tail: trimString(options.error_tail) || 'Your information is still here. Please try again.',
    };
  }

  function buildRateLimitHtml(message, retryAfter, options) {
    var ui = normalizeNoticeOptions(options);
    var until = retryAfter ? ' You may resubmit after ' + formatRetryAfter(retryAfter) + '.' : '';
    var parts = [
      trimString(message) || 'You have already submitted a recent request.',
      until,
    ];

    if (ui.google_form_url) {
      parts.push(' &mdash; <a href="' + ui.google_form_url + '" target="_blank" rel="noopener">' + ui.google_form_label + '</a>');
    }
    if (ui.rate_limit_tail) {
      parts.push(' ' + ui.rate_limit_tail);
    }
    parts.push(' or call <a href="' + ui.call_href + '">' + ui.call_label + '</a>.');
    return parts.join('');
  }

  function buildSubmitErrorHtml(message, options) {
    var ui = normalizeNoticeOptions(options);
    var parts = [
      trimString(message) || 'We could not send your request right now.',
      ' ' + ui.error_tail,
    ];

    if (ui.google_form_url) {
      parts.push(' Use the <a href="' + ui.google_form_url + '" target="_blank" rel="noopener">' + ui.google_form_label + '</a>');
    }
    if (ui.fallback_email) {
      parts.push(', email <a href="mailto:' + ui.fallback_email + '">' + ui.fallback_email + '</a>');
    }
    parts.push(', or call <a href="' + ui.call_href + '">' + ui.call_label + '</a>.');
    return parts.join('');
  }

  function submitEstimateRequest(config, options) {
    var endpoint = trimString(options && options.endpoint) || '/api/send';
    var payload = buildSubmissionPayload(config);
    var sendPayload = buildSendPayload(payload);

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload),
    }).then(function (res) {
      return readJsonResponse(res).then(function (json) {
        return {
          ok: res.ok,
          status: res.status,
          data: json,
          request_payload: payload,
          send_payload: sendPayload,
          retry_after: json && json.retry_after ? json.retry_after : '',
          error_message: buildSubmitErrorMessage(res.status, json),
        };
      });
    });
  }

  // Posts the structured canonical payload directly to /api/intake.
  // Use this instead of submitEstimateRequest for forms migrated off /api/send.
  function submitCanonicalRequest(config, options) {
    var endpoint = trimString(options && options.endpoint) || '/api/intake';
    var payload = buildSubmissionPayload(config);

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      return readJsonResponse(res).then(function (json) {
        return {
          ok: res.ok,
          status: res.status,
          data: json,
          request_payload: payload,
          retry_after: json && json.retry_after ? json.retry_after : '',
          error_message: buildSubmitErrorMessage(res.status, json),
        };
      });
    });
  }

  function buildSendPayload(config) {
    var payload = buildSubmissionPayload(config);
    return {
      subject: buildEstimateEmailSubject(payload),
      body: buildEstimateEmailBody(payload),
      html: false,
      contact_url: payload.website || '',
    };
  }

  window.FieldOpsDemoSubmission = {
    buildEstimateFromCalculator: buildEstimateFromCalculator,
    buildEstimateEmailSubject: buildEstimateEmailSubject,
    buildEstimateEmailBody: buildEstimateEmailBody,
    buildRateLimitHtml: buildRateLimitHtml,
    buildSubmitErrorMessage: buildSubmitErrorMessage,
    buildSubmitErrorHtml: buildSubmitErrorHtml,
    buildSendPayload: buildSendPayload,
    formatRetryAfter: formatRetryAfter,
    readJsonResponse: readJsonResponse,
    submitEstimateRequest: submitEstimateRequest,
    submitCanonicalRequest: submitCanonicalRequest,
    buildSubmissionPayload: buildSubmissionPayload,
    buildSubmissionSubject: buildSubmissionSubject,
    buildSubmissionBody: buildSubmissionBody,
    normalizeEstimateData: normalizeEstimateData,
    parseEstimateQuery: parseEstimateQuery,
  };
})();
