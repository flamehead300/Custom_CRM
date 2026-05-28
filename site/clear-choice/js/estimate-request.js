(function () {
    'use strict';

    var API_INTAKE = '/api/intake';
    var FALLBACK_EMAIL = 'hello@example.invalid';
    var FALLBACK_PHONE_HREF = 'tel:+15550100000';
    var FALLBACK_PHONE_DISPLAY = '(555)&nbsp;010-0000';
    var Submission = window.FieldOpsDemoSubmission || null;
    var SUBMIT_UI = {
        fallback_email: FALLBACK_EMAIL,
        call_label: FALLBACK_PHONE_DISPLAY,
        call_href: FALLBACK_PHONE_HREF
    };
    var DEFAULT_PRICING_CONFIG = Object.freeze({
        minimumCharge: 75,
        serviceLevelMultipliers: { both: 1, ext: 0.6 },
        propertyTypes: {
            res: {
                windows: { doubleHung: 10, casement: 8, picture: 7.5, storm: 16, skylight: 45 },
                extras: { screens: 2, tracks: 3, upperFloorAccess: 12 }
            },
            com: {
                windows: { doubleHung: 12, casement: 10, picture: 9.5, storm: 20, skylight: 55 },
                extras: { screens: 1.5, tracks: 2, upperFloorAccess: 15 }
            }
        },
        addons: {
            pressure: { rate: 45 },
            gutter: { rate: 35, multiplier: 0.5 },
            caulk: { rate: 100, mode: 'interest-only' }
        },
        adjustments: {
            hardWater: { multiplier: 1.25 },
            paintDebris: { flat: 35 },
            ladderWork: { flat: 25 },
            manualSkylightCleaning: { flat: 20 }
        },
        packageMultiplier: {
            deluxe: 1.25
        }
    });

    var COMMERCIAL_PRICING = Object.freeze({
        storefront: {
            minimum: 75,
            exteriorPaneRate: 4,
            bothPaneRate: 8,
            doorRate: 8,
            recurringDiscounts: {
                weekly: 0.2,
                biweekly: 0.15,
                monthly: 0.1,
                quarterly: 0.05
            }
        },
        low_rise: {
            sqftBands: {
                under_1000: [200, 350],
                sqft_1000_3000: [350, 750],
                sqft_3000_7500: [750, 1500],
                over_7500: [1500, null]
            },
            obstructionMultiplier: 0.15
        },
        mid_high_rise: {
            label: 'Site review required',
            reason: 'Access, safety, and insurance requirements must be confirmed.'
        },
        post_construction: {
            label: 'Manual review required',
            reason: 'Debris, scraping risk, and glass condition must be confirmed.'
        }
    });

    var RESIDENTIAL_WINDOW_KEYS = Object.freeze(['doubleHung', 'casement', 'picture', 'storm', 'skylight']);
    var COMMERCIAL_WINDOW_KEYS = Object.freeze(['doubleHung', 'casement', 'picture', 'storm', 'skylight']);
    var STANDARD_WINDOW_KEYS = Object.freeze(['doubleHung', 'casement', 'picture', 'storm']);

    var FREQUENCY_OPTIONS = Object.freeze({
        one_time: { label: 'One-time', multiplier: 1 },
        quarterly: { label: 'Quarterly Residential Maintenance', multiplier: 0.9 },
        monthly: { label: 'Monthly Storefront Buffing', multiplier: 0.85 }
    });

    var COMMERCIAL_FREQUENCY_OPTIONS = Object.freeze({
        one_time: { label: 'One-time cleaning', discount: 0 },
        weekly: { label: 'Weekly', discount: 0.2 },
        biweekly: { label: 'Bi-weekly', discount: 0.15 },
        monthly: { label: 'Monthly', discount: 0.1 },
        quarterly: { label: 'Quarterly', discount: 0.05 },
        semi_annual: { label: 'Semi-annual', discount: 0 },
        annual: { label: 'Annual', discount: 0 },
        not_sure: { label: 'Not sure yet', discount: 0 }
    });

    var CONDITION_OPTIONS = Object.freeze({
        normal: { label: 'Light / normal', multiplier: 1 },
        moderate: { label: 'Moderate buildup', multiplier: 1.25 },
        heavy: { label: 'Heavy buildup', multiplier: 1.5 }
    });

    var WINDOW_LABELS = Object.freeze({
        doubleHung: 'Double-hung windows',
        casement: 'Casement windows',
        picture: 'Picture windows',
        storm: 'Storm windows',
        skylight: 'Skylights'
    });

    var PACKAGE_OPTIONS = Object.freeze({
        essential: { propertyType: 'res', label: 'The Essential Clean', serviceLevel: 'ext', syncScreens: 'none', syncTracks: 'none' },
        signature: { propertyType: 'res', label: 'The Signature Detail', serviceLevel: 'both', syncScreens: 'total', syncTracks: 'none' },
        deluxe: { propertyType: 'res', label: 'The Deluxe Home Detail', serviceLevel: 'both', syncScreens: 'total', syncTracks: 'total' }
    });

    var COMMERCIAL_SCOPE_OPTIONS = Object.freeze({
        storefront: { label: 'Ground-Level Storefront', mode: 'exact' },
        low_rise: { label: 'Low-Rise Office / Facility, 1-3 Stories', mode: 'range' },
        mid_high_rise: { label: 'Mid / High-Rise Facility', mode: 'site_review', reviewReason: COMMERCIAL_PRICING.mid_high_rise.reason },
        post_construction: { label: 'Post-Construction Glass Cleanup', mode: 'manual_review', reviewReason: COMMERCIAL_PRICING.post_construction.reason }
    });

    var REVIEW_ONLY_CART_COPY = 'We will look at the details and follow up with the best service recommendation.';
    var SERVICE_KEYS = Object.freeze(['windows', 'pressure', 'gutter', 'caulk', 'review']);

    var form = document.getElementById('estimate-request-form');
    if (!form) return;

    var pricingConfig = clone(DEFAULT_PRICING_CONFIG);
    var estimateShell = document.getElementById('estimate-request-shell');
    var receiptEl = document.getElementById('estimate-receipt');
    var estimateCartEl = document.getElementById('estimate-cart');
    var stickyCartBar = document.getElementById('sticky-cart-bar');
    var stickyCartTotal = document.getElementById('sticky-cart-total');
    var stickyCartButton = document.getElementById('sticky-cart-button');
    var cartListEl = document.getElementById('cart-list');
    var cartDescriptionEl = document.getElementById('cart-description');
    var cartTotalEl = document.getElementById('cart-total');
    var cartFooterTotalEl = document.getElementById('cart-footer-total');
    var cartMinimumNoteEl = document.getElementById('cart-minimum-note');
    var serviceGroupErrorEl = document.getElementById('service-group-error');
    var serviceDetailEmptyEl = document.getElementById('service-detail-empty');
    var windowScopeErrorEl = document.getElementById('window-scope-error');
    var commercialScopeErrorEl = document.getElementById('commercial-scope-error');
    var commercialQuantityErrorEl = document.getElementById('commercial-quantity-error');
    var commercialPostConstructionErrorEl = document.getElementById('commercial-post-construction-error');
    var submitFeedbackEl = document.getElementById('estimate-submit-feedback');
    var serviceDetailPanel = document.querySelector('.estimate-services-detail');
    var commercialGeneralPanel = document.getElementById('commercial-general-panel');
    var commercialScopePanel = document.getElementById('commercial-scope-panel');
    var jobDetailsPanel = document.getElementById('job-details-panel');
    var frequencyFieldWrap = document.getElementById('frequency').closest('.form-field');
    var windowDetailsPanel = document.getElementById('window-details-panel');
    var pressureDetailsPanel = document.getElementById('pressure-details-panel');
    var gutterDetailsPanel = document.getElementById('gutter-details-panel');
    var caulkDetailsPanel = document.getElementById('caulk-details-panel');
    var commercialPressurePanel = document.getElementById('commercial-pressure-panel');
    var commercialGutterPanel = document.getElementById('commercial-gutter-panel');
    var commercialCaulkPanel = document.getElementById('commercial-caulk-panel');
    var reviewRequestPanel = document.getElementById('review-request-panel');
    var residentialPackageFieldset = document.getElementById('residential-package-fieldset');
    var residentialWindowFields = document.getElementById('residential-window-fields');
    var commercialWindowFields = document.getElementById('commercial-window-fields');
    var commercialStorefrontFields = document.getElementById('commercial-scope-storefront-fields');
    var commercialLowRiseFields = document.getElementById('commercial-scope-low-rise-fields');
    var commercialHighRiseFields = document.getElementById('commercial-scope-high-rise-fields');
    var commercialPostConstructionFields = document.getElementById('commercial-scope-post-construction-fields');
    var countSkylightWrap = document.getElementById('count_skylight_wrap');
    var businessNameField = document.getElementById('business_name_field');
    var contactNameLabel = document.getElementById('contact_name_label');
    var windowDetailsTitle = document.getElementById('window-details-title');
    var windowDetailsCopy = document.getElementById('window-details-copy');
    var caulkPanelCopy = document.getElementById('caulk-panel-copy');
    var estimateResetBtn = document.getElementById('estimate-reset');
    var submitBtn = form.querySelector('button[type="submit"]');
    var submitBtnDefaultLabel = submitBtn ? submitBtn.textContent : '';
    var screensManuallyEdited = false;
    var tracksManuallyEdited = false;
    var syncingPackagePreset = false;
    var snapshotPhotos = [];
    var addressSuggestionMap = {};
    var addressLookupTimer = null;
    var selectedAddressLabel = '';
    var selectedAddressLine1 = '';
    var infoPopoverEl = null;
    var activeInfoTrigger = null;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function roundMoney(value) {
        return Math.round(Number(value || 0) * 100) / 100;
    }

    function money(value) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function trim(value) {
        return String(value || '').trim();
    }

    function closeInfoPopover() {
        if (infoPopoverEl && infoPopoverEl.parentNode) {
            infoPopoverEl.parentNode.removeChild(infoPopoverEl);
        }
        infoPopoverEl = null;
        if (activeInfoTrigger) {
            activeInfoTrigger.setAttribute('aria-expanded', 'false');
        }
        activeInfoTrigger = null;
    }

    function positionInfoPopover(trigger) {
        if (!infoPopoverEl || !trigger) return;
        var triggerRect = trigger.getBoundingClientRect();
        var popoverRect = infoPopoverEl.getBoundingClientRect();
        var gap = 10;
        var left = triggerRect.left + (triggerRect.width / 2) - (popoverRect.width / 2);
        left = Math.max(16, Math.min(left, window.innerWidth - popoverRect.width - 16));
        var top = triggerRect.bottom + gap;
        if (top + popoverRect.height > window.innerHeight - 16) {
            top = Math.max(16, triggerRect.top - popoverRect.height - gap);
        }
        infoPopoverEl.style.left = left + 'px';
        infoPopoverEl.style.top = top + 'px';
    }

    function openInfoPopover(trigger) {
        var text = trim(trigger && trigger.getAttribute('data-info-text'));
        if (!text) return;
        if (activeInfoTrigger === trigger) {
            closeInfoPopover();
            return;
        }
        closeInfoPopover();
        infoPopoverEl = document.createElement('div');
        infoPopoverEl.className = 'info-popover';
        infoPopoverEl.setAttribute('role', 'tooltip');
        infoPopoverEl.textContent = text;
        document.body.appendChild(infoPopoverEl);
        activeInfoTrigger = trigger;
        trigger.setAttribute('aria-expanded', 'true');
        positionInfoPopover(trigger);
    }

    function setServiceInfoText(serviceKey, text) {
        var trigger = form.querySelector('[data-service-info="' + serviceKey + '"]');
        if (trigger) {
            trigger.setAttribute('data-info-text', text);
        }
    }

    function numberValue(value, fallback) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function countValue(value) {
        var parsed = Math.floor(numberValue(value, 0));
        return parsed > 0 ? parsed : 0;
    }

    function getCheckedValue(name) {
        var checked = form.querySelector('input[name="' + name + '"]:checked');
        return checked ? checked.value : '';
    }

    function getWindowPrices(propertyType) {
        return pricingConfig.propertyTypes[propertyType].windows;
    }

    function getExtraRates(propertyType) {
        return pricingConfig.propertyTypes[propertyType].extras;
    }

    function getServiceLevelMultiplier(serviceLevel) {
        return pricingConfig.serviceLevelMultipliers[serviceLevel] || 1;
    }

    function getFrequencyConfig(key) {
        return FREQUENCY_OPTIONS[key] || FREQUENCY_OPTIONS.one_time;
    }

    function getConditionConfig(key) {
        return CONDITION_OPTIONS[key] || CONDITION_OPTIONS.normal;
    }

    function buildServiceLevelLabel(propertyType, serviceLevel) {
        if (serviceLevel === 'ext') {
            return propertyType === 'com' ? 'Commercial exterior only' : 'Exterior only';
        }
        return propertyType === 'com' ? 'Commercial inside + outside' : 'Inside + outside';
    }

    function propertyTypeLabel(propertyType) {
        return propertyType === 'com' ? 'Commercial' : 'Residential';
    }

    function getCustomerType() {
        return propertyTypeLabel(getCheckedValue('property_type') || 'res');
    }

    function getPackageConfig(level) {
        return PACKAGE_OPTIONS[level] || PACKAGE_OPTIONS.signature;
    }

    function getCommercialScopeConfig(scope) {
        return COMMERCIAL_SCOPE_OPTIONS[scope] || COMMERCIAL_SCOPE_OPTIONS.storefront;
    }

    function getDefaultPackageLevel() {
        return 'signature';
    }

    function getSelectedCommercialScope() {
        return getCheckedValue('commercial_scope') || 'storefront';
    }

    function getCommercialFrequencyConfig(key) {
        return COMMERCIAL_FREQUENCY_OPTIONS[key] || COMMERCIAL_FREQUENCY_OPTIONS.one_time;
    }

    function getPackageSummaryLabel(propertyType) {
        return propertyType === 'com' ? 'Scope' : 'Package';
    }

    function getSelectedPackageLevel() {
        return getCheckedValue('package_level_res') || getDefaultPackageLevel();
    }

    function getCurrentWindowCountsFromFields() {
        return {
            doubleHung: countValue(getField('count_double_hung').value),
            casement: countValue(getField('count_casement').value),
            picture: countValue(getField('count_picture').value),
            storm: countValue(getField('count_storm').value),
            skylight: countValue(getField('count_skylight').value)
        };
    }

    function getCurrentWindowTotalFromFields() {
        var counts = getCurrentWindowCountsFromFields();
        return Object.keys(counts).reduce(function (sum, key) {
            return sum + countValue(counts[key]);
        }, 0);
    }

    function getSyncedResidentialWindowTotal(windowCounts) {
        return Object.keys(windowCounts || {}).reduce(function (sum, key) {
            if (key === 'skylight') return sum;
            return sum + countValue(windowCounts[key]);
        }, 0);
    }

    function getCommercialScopeLabel(scope) {
        return getCommercialScopeConfig(scope).label;
    }

    function getCommercialScopeMode(scope) {
        return getCommercialScopeConfig(scope).mode;
    }

    function formatEstimateBand(low, high) {
        if (high === null || high === undefined) {
            return money(low) + '+';
        }
        return money(low) + '\u2013' + money(high);
    }

    function getCommercialReviewReason(scope) {
        return getCommercialScopeConfig(scope).reviewReason || '';
    }

    function stateCode(value) {
        var cleaned = trim(value).toUpperCase();
        var map = {
            WISCONSIN: 'WI',
            ILLINOIS: 'IL'
        };
        return map[cleaned] || cleaned.slice(0, 2);
    }

    function discountPercentForFrequency(frequency) {
        var config = getFrequencyConfig(frequency);
        return config.multiplier === 1 ? 0 : Math.round((1 - config.multiplier) * 100);
    }

    function selectedServiceLabels(state) {
        var services = [];
        if (state.services.windows) {
            services.push(state.propertyType === 'com'
                ? (state.serviceLevel === 'ext' ? 'Commercial Window Cleaning (Exterior Only)' : 'Commercial Window Cleaning (Inside/Outside)')
                : (state.serviceLevel === 'ext' ? 'Window Cleaning (Exterior Only)' : 'Window Cleaning (Inside/Outside)'));
        }
        if (state.services.pressure) {
            services.push(state.propertyType === 'com' ? 'Commercial Pressure Washing' : 'Pressure Washing');
        }
        if (state.services.gutter) {
            services.push(state.propertyType === 'com' ? 'Commercial Gutter Cleaning' : 'Gutter Cleaning');
        }
        if (state.services.caulk) {
            services.push(state.propertyType === 'com' ? 'Commercial Caulking / Sealing' : 'Caulking / Sealing');
        }
        if (state.services.review) {
            services.push('Not sure / Need review');
        }
        return services;
    }

    function getField(id) {
        return document.getElementById(id);
    }

    function fieldValue(id) {
        var field = getField(id);
        return field ? field.value : '';
    }

    function fieldChecked(id) {
        var field = getField(id);
        return !!(field && field.checked);
    }

    function selectedServiceCount(services) {
        return SERVICE_KEYS.reduce(function (count, key) {
            return count + (services && services[key] ? 1 : 0);
        }, 0);
    }

    function hasAnySelectedService(services) {
        return selectedServiceCount(services) > 0;
    }

    function isReviewOnlySelection(services) {
        return !!(services && services.review && selectedServiceCount(services) === 1);
    }

    function setPanelState(panel, isVisible) {
        if (!panel) return;
        panel.hidden = !isVisible;
        panel.querySelectorAll('input, select, textarea, button').forEach(function (field) {
            field.disabled = !isVisible;
        });
    }

    function getFieldError(id) {
        return form.querySelector('[data-error-for="' + id + '"]');
    }

    function clearFieldError(id) {
        var field = getField(id);
        var error = getFieldError(id);
        if (field) {
            field.classList.remove('input-error');
            field.setAttribute('aria-invalid', 'false');
        }
        if (error) {
            error.hidden = true;
            error.textContent = error.dataset.defaultMessage || error.textContent;
        }
    }

    function setFieldError(id, message) {
        var field = getField(id);
        var error = getFieldError(id);
        if (field) {
            field.classList.add('input-error');
            field.setAttribute('aria-invalid', 'true');
        }
        if (error) {
            if (!error.dataset.defaultMessage) {
                error.dataset.defaultMessage = error.textContent;
            }
            error.textContent = message;
            error.hidden = false;
        }
    }

    function clearAllErrors() {
        form.querySelectorAll('.field-error, .group-error').forEach(function (errorEl) {
            errorEl.hidden = true;
        });
        form.querySelectorAll('.input-error').forEach(function (field) {
            field.classList.remove('input-error');
            field.setAttribute('aria-invalid', 'false');
        });
    }

    function readState() {
        var propertyType = getCheckedValue('property_type') || 'res';
        var services = {
            windows: fieldChecked('service_windows'),
            pressure: fieldChecked('service_pressure'),
            gutter: fieldChecked('service_gutter'),
            caulk: fieldChecked('service_caulk'),
            review: fieldChecked('service_review')
        };
        var isCommercial = propertyType === 'com';
        var commercialHasServices = isCommercial && hasAnySelectedService(services);
        var commercialWindowsActive = isCommercial && services.windows;
        var residentialWindowsActive = propertyType === 'res' && services.windows;
        var residentialPressureActive = propertyType === 'res' && services.pressure;
        var residentialGutterActive = propertyType === 'res' && services.gutter;
        var residentialFrequencyConfig = getFrequencyConfig(fieldValue('frequency'));
        var commercialFrequencyKey = commercialWindowsActive ? trim(fieldValue('commercial_frequency')) : '';
        var commercialFrequencyConfig = getCommercialFrequencyConfig(commercialFrequencyKey);
        var conditionConfig = getConditionConfig(fieldValue('glass_condition'));
        var selectedPackageLevel = getSelectedPackageLevel();
        var commercialScope = getSelectedCommercialScope();
        var commercialScopeConfig = getCommercialScopeConfig(commercialScope);
        var residentialWindowCounts = getCurrentWindowCountsFromFields();
        var residentialExtras = {
            screens: residentialWindowsActive ? countValue(fieldValue('screens')) : 0,
            tracks: residentialWindowsActive ? countValue(fieldValue('tracks')) : 0,
            hardWater: false,
            paintDebris: false,
            ladderWork: false,
            manualSkylightCleaning: false
        };
        var residentialFrequency = {
            key: fieldValue('frequency'),
            label: residentialFrequencyConfig.label,
            multiplier: residentialFrequencyConfig.multiplier,
            discountPercent: discountPercentForFrequency(fieldValue('frequency'))
        };
        var commercialFrequency = {
            key: commercialFrequencyKey,
            label: commercialFrequencyConfig.label,
            multiplier: 1 - numberValue(commercialFrequencyConfig.discount, 0),
            discountPercent: Math.round(numberValue(commercialFrequencyConfig.discount, 0) * 100)
        };
        var commercialServiceLevel = commercialWindowsActive ? (fieldValue('commercial_service_level') || 'ext') : '';
        var commercialStories = '';
        if (commercialWindowsActive && commercialScope === 'low_rise') {
            commercialStories = trim(fieldValue('commercial_low_rise_stories'));
        } else if (commercialWindowsActive && commercialScope === 'mid_high_rise') {
            commercialStories = trim(fieldValue('commercial_high_rise_stories'));
        }
        var commercialPropertyUseType = commercialHasServices ? trim(fieldValue('commercial_property_use_type')) : '';
        return {
            propertyType: propertyType,
            address: {
                line1: trim(fieldValue('address_line1')),
                city: trim(fieldValue('city')),
                state: trim(fieldValue('state')).toUpperCase(),
                zip: trim(fieldValue('zip'))
            },
            services: services,
            floors: Math.max(1, Math.min(3, countValue(fieldValue('floors')) || 1)),
            frequency: propertyType === 'com' ? commercialFrequency : residentialFrequency,
            package: propertyType === 'com'
                ? (commercialWindowsActive
                    ? { level: commercialScope, label: commercialScopeConfig.label }
                    : { level: '', label: '' })
                : { level: selectedPackageLevel, label: getPackageConfig(selectedPackageLevel).label },
            serviceLevel: propertyType === 'com' ? commercialServiceLevel : fieldValue('service_level'),
            condition: {
                key: fieldValue('glass_condition'),
                label: conditionConfig.label,
                multiplier: conditionConfig.multiplier
            },
            windowCounts: residentialWindowCounts,
            extras: residentialExtras,
            addons: {
                pressureWalls: residentialPressureActive ? Math.max(0, countValue(fieldValue('pressure_walls'))) : 0,
                gutterWalls: residentialGutterActive ? Math.max(0, countValue(fieldValue('gutter_walls'))) : 0
            },
            residential: {
                package: {
                    level: selectedPackageLevel,
                    label: getPackageConfig(selectedPackageLevel).label
                },
                frequency: residentialFrequency,
                serviceLevel: fieldValue('service_level'),
                condition: {
                    key: fieldValue('glass_condition'),
                    label: conditionConfig.label,
                    multiplier: conditionConfig.multiplier
                },
                windowCounts: residentialWindowCounts,
                extras: residentialExtras
            },
            commercial: {
                scope: commercialScope,
                scopeLabel: commercialScopeConfig.label,
                propertyType: commercialPropertyUseType,
                propertyUseType: commercialPropertyUseType,
                preferredServiceTime: commercialHasServices ? trim(fieldValue('commercial_preferred_service_time')) : '',
                operatingConstraints: commercialHasServices ? trim(fieldValue('commercial_operating_constraints')) : '',
                frequency: commercialFrequency.key,
                frequencyLabel: commercialFrequency.label,
                stories: commercialStories,
                glassSqftRange: commercialWindowsActive && commercialScope === 'low_rise' ? trim(fieldValue('commercial_glass_sqft_range')) : '',
                windowCount: commercialWindowsActive && commercialScope === 'storefront' ? countValue(fieldValue('commercial_window_count')) : 0,
                doors: commercialWindowsActive && commercialScope === 'storefront' ? countValue(fieldValue('commercial_doors')) : 0,
                serviceLevel: commercialServiceLevel,
                glassQuantityMode: commercialWindowsActive ? trim(fieldValue('commercial_glass_quantity_mode')) : '',
                accessNotes: commercialWindowsActive ? trim(fieldValue('commercial_access_notes')) : '',
                accessFlags: {
                    publicAccessConstraints: commercialWindowsActive && commercialScope === 'storefront' && fieldChecked('commercial_public_access_constraints'),
                    waterFedPolePossible: commercialWindowsActive && commercialScope === 'low_rise' && fieldChecked('commercial_water_fed_pole_possible'),
                    obstructionsPresent: commercialWindowsActive && commercialScope === 'low_rise' && fieldChecked('commercial_obstructions_present'),
                    liftRequired: commercialWindowsActive && commercialScope === 'mid_high_rise' && fieldChecked('commercial_lift_required'),
                    ropeAccessPossible: commercialWindowsActive && commercialScope === 'mid_high_rise' && fieldChecked('commercial_rope_access_possible'),
                    roofAccessAvailable: commercialWindowsActive && commercialScope === 'mid_high_rise' && fieldChecked('commercial_roof_access_available'),
                    anchorPointsKnown: commercialWindowsActive && commercialScope === 'mid_high_rise' && fieldChecked('commercial_anchor_points_known'),
                    coiRequired: commercialWindowsActive && commercialScope === 'mid_high_rise' && fieldChecked('commercial_coi_required'),
                    siteWalkRequired: commercialWindowsActive && commercialScope === 'mid_high_rise' && fieldChecked('commercial_site_walk_required')
                },
                constructionDebris: {
                    paintOverspray: commercialWindowsActive && commercialScope === 'post_construction' && fieldChecked('commercial_debris_paint_overspray'),
                    concreteDust: commercialWindowsActive && commercialScope === 'post_construction' && fieldChecked('commercial_debris_concrete_dust'),
                    adhesiveStickers: commercialWindowsActive && commercialScope === 'post_construction' && fieldChecked('commercial_debris_adhesive_stickers')
                },
                temperedGlassAcknowledged: commercialWindowsActive && commercialScope === 'post_construction' && fieldChecked('commercial_tempered_glass_ack'),
                turnoverDate: commercialWindowsActive && commercialScope === 'post_construction' ? trim(fieldValue('commercial_turnover_date')) : '',
                manualReviewRequired: false,
                estimateBand: '',
                estimatedTotal: null
            },
            commercialPressure: {
                areasToClean: isCommercial && services.pressure ? trim(fieldValue('commercial_pressure_areas_to_clean')) : '',
                dimensions: isCommercial && services.pressure ? trim(fieldValue('commercial_pressure_dimensions')) : '',
                surfaceType: isCommercial && services.pressure ? trim(fieldValue('commercial_pressure_surface_type')) : '',
                condition: isCommercial && services.pressure ? trim(fieldValue('commercial_pressure_condition')) : '',
                accessConstraints: isCommercial && services.pressure ? trim(fieldValue('commercial_pressure_access_constraints')) : '',
                operatingConstraints: isCommercial && services.pressure ? trim(fieldValue('commercial_pressure_operating_constraints')) : ''
            },
            commercialGutter: {
                buildingHeight: isCommercial && services.gutter ? trim(fieldValue('commercial_gutter_building_height')) : '',
                guards: isCommercial && services.gutter ? trim(fieldValue('commercial_gutter_guards')) : '',
                debrisLevel: isCommercial && services.gutter ? trim(fieldValue('commercial_gutter_debris_level')) : '',
                accessConcerns: isCommercial && services.gutter ? trim(fieldValue('commercial_gutter_access_concerns')) : '',
                roofSafety: isCommercial && services.gutter ? trim(fieldValue('commercial_gutter_roof_safety')) : ''
            },
            commercialCaulk: {
                location: isCommercial && services.caulk ? trim(fieldValue('commercial_caulk_location')) : '',
                surfaceMaterial: isCommercial && services.caulk ? trim(fieldValue('commercial_caulk_surface_material')) : '',
                issueType: isCommercial && services.caulk ? trim(fieldValue('commercial_caulk_issue_type')) : '',
                accessNotes: isCommercial && services.caulk ? trim(fieldValue('commercial_caulk_access_notes')) : ''
            },
            reviewRequest: {
                description: services.review ? trim(fieldValue('review_request_description')) : ''
            },
            contact: {
                name: trim(fieldValue('contact_name')),
                businessName: trim(fieldValue('business_name')),
                phone: trim(fieldValue('phone')),
                email: trim(fieldValue('email')),
                preferredContactMethod: trim(fieldValue('preferred_contact_method')) || 'No preference',
                bestTime: trim(fieldValue('best_time')) || 'Any time'
            },
            customerType: getCustomerType(),
            uploadedPhotos: snapshotPhotos.slice(),
            notes: trim(fieldValue('notes')),
            consent: fieldChecked('consent')
        };
    }

    function parseManualAddress(value) {
        var raw = trim(value);
        var parts = raw.split(',').map(function (part) { return trim(part); }).filter(Boolean);
        var parsed = { line1: raw, city: '', state: '', zip: '' };
        if (parts.length >= 2) {
            parsed.line1 = parts[0];
            parsed.city = parts[1];
            var stateZip = parts.slice(2).join(' ');
            var match = stateZip.match(/\b([A-Za-z]{2}|Wisconsin|Illinois)\b\s*(\d{5}(?:-\d{4})?)?/i);
            if (match) {
                parsed.state = stateCode(match[1]);
                parsed.zip = match[2] || '';
            }
        } else {
            var inline = raw.match(/^(.*?)(?:\s+)([A-Za-z .'-]+),?\s+([A-Za-z]{2}|Wisconsin|Illinois)\s+(\d{5}(?:-\d{4})?)$/i);
            if (inline) {
                parsed.line1 = trim(inline[1]);
                parsed.city = trim(inline[2]);
                parsed.state = stateCode(inline[3]);
                parsed.zip = inline[4];
            }
        }
        return parsed;
    }

    function normalizeState(state) {
        state.customerType = propertyTypeLabel(state.propertyType);
        state.package = state.propertyType === 'com'
            ? (state.services.windows
                ? { level: state.commercial.scope, label: getCommercialScopeLabel(state.commercial.scope) }
                : { level: '', label: '' })
            : { level: state.residential.package.level, label: state.residential.package.label };
        state.frequency = state.propertyType === 'com'
            ? {
                key: state.commercial.frequency,
                label: state.commercial.frequencyLabel,
                multiplier: 1 - numberValue(getCommercialFrequencyConfig(state.commercial.frequency).discount, 0),
                discountPercent: Math.round(numberValue(getCommercialFrequencyConfig(state.commercial.frequency).discount, 0) * 100)
            }
            : state.residential.frequency;
        state.serviceLevel = state.propertyType === 'com' ? state.commercial.serviceLevel : state.residential.serviceLevel;

        state.address.state = state.address.state.slice(0, 2);
        getField('state').value = state.address.state;

        if (state.address.line1 && (!state.address.city || !state.address.zip)) {
            var rawAddressText = state.address.line1;
            var parsedAddress = parseManualAddress(state.address.line1);
            if (parsedAddress.line1) {
                state.address.line1 = parsedAddress.line1;
                getField('address_line1').value = parsedAddress.line1;
            }
            state.address.city = state.address.city || parsedAddress.city || 'Manual entry';
            state.address.state = stateCode(state.address.state || parsedAddress.state || 'WI');
            state.address.zip = state.address.zip || parsedAddress.zip || '00000';
            getField('city').value = state.address.city;
            getField('state').value = state.address.state;
            getField('zip').value = state.address.zip;
            if (selectedAddressLine1 !== trim(getField('address_line1').value)) {
                var manualNote = 'Typed-only service address: ' + rawAddressText;
                state.notes = state.notes ? state.notes + '\n\n' + manualNote : manualNote;
            }
        }

        state.commercial.manualReviewRequired = state.propertyType === 'com'
            && state.services.windows
            && (getCommercialScopeMode(state.commercial.scope) === 'site_review' || getCommercialScopeMode(state.commercial.scope) === 'manual_review');

        return state;
    }

    function syncPackageCounts(level) {
        if ((getCheckedValue('property_type') || 'res') !== 'res') return;
        var config = getPackageConfig(level || getSelectedPackageLevel());
        var windowCounts = getCurrentWindowCountsFromFields();
        var syncedTotal = getSyncedResidentialWindowTotal(windowCounts);
        syncingPackagePreset = true;
        if (!screensManuallyEdited) {
            if (config.syncScreens === 'total') {
                getField('screens').value = String(syncedTotal);
            } else if (config.syncScreens === 'none') {
                getField('screens').value = '0';
            }
        }
        if (!tracksManuallyEdited) {
            if (config.syncTracks === 'total') {
                getField('tracks').value = String(syncedTotal);
            } else if (config.syncTracks === 'none') {
                getField('tracks').value = '0';
            }
        }
        syncingPackagePreset = false;
    }

    function applyPackagePreset(level) {
        var config = getPackageConfig(level);
        var packageField = getField('package_' + (PACKAGE_OPTIONS[level] ? level : getDefaultPackageLevel()));
        if (packageField) packageField.checked = true;

        syncingPackagePreset = true;
        getField('service_windows').checked = true;
        getField('service_level').value = config.serviceLevel;
        screensManuallyEdited = false;
        tracksManuallyEdited = false;
        if (config.syncScreens === 'none') {
            getField('screens').value = '0';
        }
        if (config.syncTracks === 'none') {
            getField('tracks').value = '0';
        }
        syncingPackagePreset = false;
        syncPackageCounts(level);
        clearGroupErrors();
        updateAll();
    }

    function isPackageCustomized(state) {
        if (state.propertyType !== 'res') return false;
        var config = getPackageConfig(state.package.level);
        var expectedTotal = getSyncedResidentialWindowTotal(state.windowCounts);
        var expectedScreens = config.syncScreens === 'total' ? expectedTotal : 0;
        var expectedTracks = config.syncTracks === 'total' ? expectedTotal : 0;
        if (!state.services.windows) return true;
        if (state.extras.hardWater) return true;
        return state.serviceLevel !== config.serviceLevel
            || state.extras.screens !== expectedScreens
            || state.extras.tracks !== expectedTracks;
    }

    function calculateEstimate(state) {
        var lineItems = [];
        var running = 0;
        var hasChargeableLine = false;
        var totalWindows = state.propertyType === 'com'
            ? countValue(state.commercial.windowCount)
            : Object.keys(state.windowCounts).reduce(function (sum, key) {
                return sum + countValue(state.windowCounts[key]);
            }, 0);
        var displayMode = 'exact';
        var reviewReason = '';
        var totalText = money(0);
        var range = null;
        var minimumApplied = false;
        var commercialSummary = null;
        var exactPresent = false;
        var rangePresent = false;
        var manualReviewPresent = false;

        function pushLine(label, amount, sublabel, options) {
            options = options || {};
            var rounded = roundMoney(amount);
            lineItems.push({
                label: label,
                amount: rounded,
                sublabel: sublabel || '',
                quoteOnly: !!options.quoteOnly,
                kind: options.kind || '',
                displayAmount: options.displayAmount || ''
            });
            if (!options.quoteOnly) {
                running = roundMoney(running + rounded);
                if (rounded > 0) {
                    hasChargeableLine = true;
                }
            }
        }

        if (state.services.windows) {
            if (state.propertyType === 'res') {
                var prices = getWindowPrices('res');
                var extras = getExtraRates('res');
                var serviceLevelMultiplier = getServiceLevelMultiplier(state.serviceLevel);
                var packageConfig = getPackageConfig(state.package.level);
                Object.keys(state.windowCounts).forEach(function (key) {
                    var count = state.windowCounts[key];
                    if (!count) return;
                    var rate = roundMoney(prices[key] * serviceLevelMultiplier);
                    pushLine(WINDOW_LABELS[key] + ' (' + count + ' x ' + money(rate) + ')', roundMoney(count * rate));
                });

                if (state.extras.screens > 0) {
                    pushLine('Screens (' + state.extras.screens + ' x ' + money(extras.screens) + ')', roundMoney(state.extras.screens * extras.screens));
                }

                if (state.extras.tracks > 0) {
                    pushLine('Tracks (' + state.extras.tracks + ' x ' + money(extras.tracks) + ')', roundMoney(state.extras.tracks * extras.tracks));
                }

                var extraFloors = Math.max(0, state.floors - 1);
                var hasWindowScope = totalWindows > 0 || state.extras.screens > 0 || state.extras.tracks > 0;
                if (extraFloors && hasWindowScope) {
                    pushLine('Upper-floor access (' + extraFloors + ' x ' + money(extras.upperFloorAccess) + ')', roundMoney(extraFloors * extras.upperFloorAccess));
                }

                var deluxeRate = (pricingConfig.packageMultiplier || {}).deluxe;
                if (state.package.level === 'deluxe' && deluxeRate > 1 && running > 0) {
                    pushLine(
                        'Deluxe detail (' + Math.round((deluxeRate - 1) * 100) + '% premium)',
                        roundMoney(running * (deluxeRate - 1)),
                        'Track detail, frame wiping, door glass'
                    );
                }
            } else {
                var commercialScope = state.commercial.scope;
                var commercialScopeLabel = getCommercialScopeLabel(commercialScope);
                var commercialMode = getCommercialScopeMode(commercialScope);
                var storefrontConfig = COMMERCIAL_PRICING.storefront;
                var lowRiseConfig = COMMERCIAL_PRICING.low_rise;
                var commercialWindowCount = countValue(state.commercial.windowCount);
                var commercialDoorCount = countValue(state.commercial.doors);
                var storefrontPaneRate = state.commercial.serviceLevel === 'both'
                    ? storefrontConfig.bothPaneRate
                    : storefrontConfig.exteriorPaneRate;
                var storefrontDiscount = numberValue(storefrontConfig.recurringDiscounts[state.commercial.frequency], 0);
                var obstructionSelected = !!(
                    state.commercial.accessFlags.obstructionsPresent
                    || state.commercial.accessFlags.publicAccessConstraints
                    || state.commercial.accessFlags.liftRequired
                    || state.commercial.accessFlags.ropeAccessPossible
                    || state.commercial.accessFlags.siteWalkRequired
                );

                if (commercialMode === 'exact') {
                    var hasStorefrontQuantity = commercialWindowCount > 0 || commercialDoorCount > 0;
                    if (hasStorefrontQuantity) {
                        exactPresent = true;
                    }
                    if (commercialWindowCount > 0) {
                        pushLine(
                            commercialScopeLabel + ' panes (' + commercialWindowCount + ' x ' + money(storefrontPaneRate) + ')',
                            roundMoney(commercialWindowCount * storefrontPaneRate),
                            state.commercial.serviceLevel === 'both' ? 'Inside + outside storefront glass' : 'Exterior storefront glass'
                        );
                    }
                    if (commercialDoorCount > 0) {
                        pushLine(
                            'Entry doors (' + commercialDoorCount + ' x ' + money(storefrontConfig.doorRate) + ')',
                            roundMoney(commercialDoorCount * storefrontConfig.doorRate)
                        );
                    }
                    if (storefrontDiscount > 0 && running > 0) {
                        pushLine(
                            state.commercial.frequencyLabel + ' route discount',
                            roundMoney(running * -storefrontDiscount),
                            Math.round(storefrontDiscount * 100) + '% off',
                            { kind: 'discount' }
                        );
                    }
                    commercialSummary = {
                        scope: commercialScope,
                        scopeLabel: commercialScopeLabel,
                        mode: 'exact',
                        reviewReason: '',
                        estimatedTotal: null,
                        estimateBand: ''
                    };
                } else if (commercialMode === 'range') {
                    rangePresent = true;
                    var baseBand = lowRiseConfig.sqftBands[state.commercial.glassSqftRange] || null;
                    var bandLow = baseBand ? baseBand[0] : 0;
                    var bandHigh = baseBand ? baseBand[1] : null;
                    if (obstructionSelected && bandLow) {
                        bandLow = roundMoney(bandLow * (1 + lowRiseConfig.obstructionMultiplier));
                        if (bandHigh !== null) {
                            bandHigh = roundMoney(bandHigh * (1 + lowRiseConfig.obstructionMultiplier));
                        }
                    }
                    pushLine(
                        commercialScopeLabel,
                        0,
                        state.commercial.serviceLevel === 'both'
                            ? 'Inside + outside facility glass with final price confirmed after review.'
                            : 'Exterior facility glass with final price confirmed after review.',
                        { displayAmount: baseBand ? formatEstimateBand(bandLow, bandHigh) : 'Estimate range pending' }
                    );
                    range = { low: bandLow, high: bandHigh };
                    displayMode = 'range';
                    commercialSummary = {
                        scope: commercialScope,
                        scopeLabel: commercialScopeLabel,
                        mode: 'range',
                        reviewReason: 'Final price confirmed after site review.',
                        estimatedTotal: null,
                        estimateBand: baseBand ? formatEstimateBand(bandLow, bandHigh) : ''
                    };
                } else {
                    manualReviewPresent = true;
                    displayMode = 'manual_review';
                    reviewReason = getCommercialReviewReason(commercialScope);
                    pushLine(
                        commercialScopeLabel,
                        0,
                        reviewReason,
                        {
                            quoteOnly: true,
                            kind: 'scope',
                            displayAmount: commercialMode === 'site_review' ? 'Site review required' : 'Manual review required'
                        }
                    );
                    commercialSummary = {
                        scope: commercialScope,
                        scopeLabel: commercialScopeLabel,
                        mode: 'manual_review',
                        reviewReason: reviewReason,
                        estimatedTotal: null,
                        estimateBand: ''
                    };
                }
            }
        }

        if (state.services.pressure) {
            if (state.propertyType === 'com') {
                manualReviewPresent = true;
                pushLine(
                    'Commercial pressure washing',
                    0,
                    'Manual review required for areas, dimensions, surfaces, access, and operating constraints.',
                    { quoteOnly: true, kind: 'review', displayAmount: 'Manual review required' }
                );
            } else {
                pushLine(
                    'Pressure washing (' + state.addons.pressureWalls + ' wall' + (state.addons.pressureWalls === 1 ? '' : 's') + ' x ' + state.floors + ' floor' + (state.floors === 1 ? '' : 's') + ')',
                    roundMoney(state.addons.pressureWalls * pricingConfig.addons.pressure.rate * state.floors)
                );
            }
        }

        if (state.services.gutter) {
            if (state.propertyType === 'com') {
                manualReviewPresent = true;
                pushLine(
                    'Commercial gutter cleaning',
                    0,
                    'Manual review required for height, debris level, roofline access, and safety.',
                    { quoteOnly: true, kind: 'review', displayAmount: 'Manual review required' }
                );
            } else {
                pushLine(
                    'Gutter cleaning (' + state.addons.gutterWalls + ' wall' + (state.addons.gutterWalls === 1 ? '' : 's') + ' x ' + state.floors + ' floor' + (state.floors === 1 ? '' : 's') + ' x ' + pricingConfig.addons.gutter.multiplier + ')',
                    roundMoney(state.addons.gutterWalls * pricingConfig.addons.gutter.rate * state.floors * pricingConfig.addons.gutter.multiplier)
                );
            }
        }

        if (state.services.caulk) {
            if (state.propertyType === 'com') {
                manualReviewPresent = true;
                pushLine(
                    'Commercial caulking / sealing',
                    0,
                    'Manual review required for location, material, issue type, and access.',
                    { quoteOnly: true, kind: 'review', displayAmount: 'Manual review required' }
                );
            } else if (pricingConfig.addons.caulk.mode === 'interest-only') {
                manualReviewPresent = true;
                pushLine('Caulking / sealing', 0, pricingConfig.addons.caulk.lineItemCopy || 'Quoted separately after review', { quoteOnly: true, kind: 'review', displayAmount: 'Review required' });
            } else {
                pushLine('Caulking / sealing', roundMoney(pricingConfig.addons.caulk.rate));
            }
        }

        if (state.services.review) {
            manualReviewPresent = true;
            pushLine(
                'Not sure / Need review',
                0,
                REVIEW_ONLY_CART_COPY,
                { quoteOnly: true, kind: 'review', displayAmount: 'Review required' }
            );
        }

        if (state.propertyType === 'res' && state.services.windows && state.condition.multiplier !== 1 && running > 0) {
            pushLine('Glass condition adjustment', roundMoney(running * (state.condition.multiplier - 1)), state.condition.label);
        }

        if (state.propertyType === 'res' && state.frequency.multiplier !== 1 && running > 0) {
            var discountPercent = Math.round((1 - state.frequency.multiplier) * 100);
            pushLine(state.frequency.label + ' discount', roundMoney(running * (state.frequency.multiplier - 1)), discountPercent + '% off', { kind: 'discount' });
        }

        var total = running;
        if (state.propertyType === 'res') {
            if (manualReviewPresent && !hasChargeableLine) {
                displayMode = 'manual_review';
                total = 0;
                totalText = 'Review required';
                reviewReason = reviewReason || REVIEW_ONLY_CART_COPY;
            } else if (hasChargeableLine && total < pricingConfig.minimumCharge) {
                total = pricingConfig.minimumCharge;
                minimumApplied = true;
                totalText = money(total);
            } else {
                totalText = money(total);
            }
        } else {
            if (rangePresent) {
                displayMode = 'range';
                if (range) {
                    total = roundMoney((range.low || 0) + running);
                    range = {
                        low: roundMoney((range.low || 0) + running),
                        high: range.high === null ? null : roundMoney(range.high + running)
                    };
                    totalText = formatEstimateBand(range.low, range.high);
                    if (commercialSummary) {
                        commercialSummary.estimateBand = totalText;
                    }
                } else {
                    total = 0;
                    totalText = 'Estimate range pending';
                }
            } else if (exactPresent) {
                displayMode = 'exact';
                if (hasChargeableLine && total < COMMERCIAL_PRICING.storefront.minimum) {
                    total = COMMERCIAL_PRICING.storefront.minimum;
                    minimumApplied = true;
                }
                totalText = money(total);
                if (commercialSummary) {
                    commercialSummary.estimatedTotal = total;
                }
            } else if (manualReviewPresent) {
                displayMode = 'manual_review';
                total = 0;
                totalText = 'Review required';
                reviewReason = reviewReason || REVIEW_ONLY_CART_COPY;
            } else {
                totalText = money(total);
            }
        }

        return {
            lineItems: lineItems,
            total: roundMoney(total),
            running: roundMoney(running),
            minimumApplied: minimumApplied,
            hasChargeableLine: hasChargeableLine,
            totalWindows: totalWindows,
            totalIsCustom: displayMode === 'manual_review',
            displayMode: displayMode,
            displayTotalText: totalText,
            range: range,
            reviewReason: reviewReason,
            commercial: commercialSummary,
            hasManualReview: manualReviewPresent,
            hasExact: exactPresent,
            hasRange: rangePresent,
            summaryLabel: displayMode === 'range'
                ? 'Estimated range'
                : (manualReviewPresent && hasChargeableLine ? 'Estimated priced subtotal' : 'Estimated total')
        };
    }

    function renderCart(state, result) {
        var selectedCount = selectedServiceLabels(state).length;
        cartDescriptionEl.textContent = !selectedCount
            ? 'Add your services to see your subtotal here.'
            : (isReviewOnlySelection(state.services)
                ? REVIEW_ONLY_CART_COPY
                : (state.propertyType === 'com'
                    ? (result.displayMode === 'exact'
                        ? (result.hasManualReview
                            ? 'Priced services are subtotaled here. Review-only services will be confirmed separately.'
                            : 'Ground-level storefront cleaning estimate.')
                        : (result.displayMode === 'range'
                            ? (result.hasManualReview
                                ? 'Estimated range shown for priced services. Review-only services will be confirmed separately.'
                                : 'Estimated range shown. Final price confirmed after site review.')
                            : result.reviewReason || 'We need to confirm access, property conditions, and service requirements before final pricing.'))
                    : 'Your subtotal is updating as you build your service plan.'));

        var totalText = result.displayTotalText || money(result.total);
        var totalLabel = result.summaryLabel || 'Estimated total';
        estimateCartEl.querySelectorAll('.cart-total-label').forEach(function (labelEl) {
            labelEl.textContent = totalLabel;
        });
        var stickyLabel = stickyCartBar.querySelector('.sticky-cart-label');
        if (stickyLabel) {
            stickyLabel.textContent = totalLabel;
        }
        cartTotalEl.textContent = totalText;
        cartFooterTotalEl.textContent = totalText;
        stickyCartTotal.textContent = totalText;

        if (!selectedCount) {
            cartListEl.innerHTML = '<div class="cart-empty">Choose the services you want to include, and your price will start taking shape here.</div>';
            cartMinimumNoteEl.textContent = '';
            return;
        }

        if (!result.lineItems.length) {
            cartListEl.innerHTML = '<div class="cart-empty">Add your counts and details so we can dial in the numbers for the services you selected.</div>';
            cartMinimumNoteEl.textContent = '';
            return;
        }

        cartListEl.innerHTML = result.lineItems.map(function (item) {
            var amountClass = 'cart-row-amount';
            var amountText = item.displayAmount || money(item.amount);
            if (item.kind === 'discount') {
                amountClass += ' discount';
            }
            if (item.quoteOnly) {
                amountClass += ' quote';
                amountText = item.displayAmount || 'Custom quote';
            }
            return (
                '<div class="cart-row">' +
                '<div class="cart-row-label">' +
                escapeHtml(item.label) +
                (item.sublabel ? '<span class="cart-row-sub">' + escapeHtml(item.sublabel) + '</span>' : '') +
                '</div>' +
                '<div class="' + amountClass + '">' + escapeHtml(amountText) + '</div>' +
                '</div>'
            );
        }).join('');

        cartMinimumNoteEl.textContent = (result.displayMode === 'manual_review' || result.displayMode === 'range')
            ? ''
            : (result.minimumApplied
                ? 'Minimum service charge applied: ' + money(state.propertyType === 'com' ? COMMERCIAL_PRICING.storefront.minimum : pricingConfig.minimumCharge) + '.'
                : '');
    }

    function buildCommercialContext(state, result) {
        if (state.propertyType !== 'com' || !hasAnySelectedService(state.services)) {
            return null;
        }
        return {
            property_use_type: state.commercial.propertyUseType,
            propertyUseType: state.commercial.propertyUseType,
            preferred_service_time: state.commercial.preferredServiceTime,
            preferredServiceTime: state.commercial.preferredServiceTime,
            operating_constraints: state.commercial.operatingConstraints,
            operatingConstraints: state.commercial.operatingConstraints,
            business_name: state.contact.businessName,
            quote_mode: result.displayMode === 'range' ? 'range' : (result.displayMode === 'exact' ? 'exact' : 'manual_review'),
            manual_review_required: !!result.hasManualReview || result.displayMode === 'manual_review',
            estimated_total: result.displayMode === 'exact' ? result.total : null,
            estimate_band: result.displayMode === 'range' ? result.displayTotalText : ''
        };
    }

    function buildServiceDetails(state, result) {
        var details = {};
        if (state.services.windows) {
            if (state.propertyType === 'com') {
                var commercialMode = getCommercialScopeMode(state.commercial.scope);
                var windowQuoteMode = commercialMode === 'exact' ? 'exact' : (commercialMode === 'range' ? 'range' : 'manual_review');
                details.windows = {
                    enabled: true,
                    branch: 'commercial',
                    quote_mode: windowQuoteMode,
                    manual_review_required: windowQuoteMode === 'manual_review',
                    estimated_total: windowQuoteMode === 'exact' && result.commercial ? result.commercial.estimatedTotal : null,
                    estimate_band: windowQuoteMode === 'range' && result.commercial ? result.commercial.estimateBand : '',
                    inputs: {
                        scope: state.commercial.scope,
                        frequency: state.commercial.frequency,
                        glass_quantity_mode: state.commercial.glassQuantityMode,
                        service_level: state.commercial.serviceLevel,
                        access_notes: state.commercial.accessNotes,
                        panes: state.commercial.scope === 'storefront' ? state.commercial.windowCount : 0,
                        doors: state.commercial.scope === 'storefront' ? state.commercial.doors : 0,
                        glass_sqft_range: state.commercial.scope === 'low_rise' ? state.commercial.glassSqftRange : '',
                        stories: state.commercial.stories,
                        public_access_constraints: state.commercial.accessFlags.publicAccessConstraints,
                        water_fed_pole_possible: state.commercial.accessFlags.waterFedPolePossible,
                        obstructions_present: state.commercial.accessFlags.obstructionsPresent,
                        lift_required: state.commercial.accessFlags.liftRequired,
                        rope_access_possible: state.commercial.accessFlags.ropeAccessPossible,
                        roof_access_available: state.commercial.accessFlags.roofAccessAvailable,
                        anchor_points_known: state.commercial.accessFlags.anchorPointsKnown,
                        coi_required: state.commercial.accessFlags.coiRequired,
                        site_walk_required: state.commercial.accessFlags.siteWalkRequired,
                        debris_flags: state.commercial.constructionDebris,
                        tempered_glass_acknowledged: state.commercial.temperedGlassAcknowledged,
                        turnover_date: state.commercial.turnoverDate
                    }
                };
            } else {
                details.windows = {
                    enabled: true,
                    branch: 'residential',
                    quote_mode: 'exact',
                    manual_review_required: false,
                    estimated_total: result.displayMode === 'exact' ? result.total : null,
                    inputs: {
                        package_level: state.package.level,
                        service_level: state.serviceLevel,
                        floors: state.floors,
                        frequency: state.frequency.key,
                        glass_condition: state.condition.key,
                        window_counts: state.windowCounts,
                        extras: state.extras
                    }
                };
            }
        }

        if (state.services.pressure) {
            details.pressure = state.propertyType === 'com'
                ? {
                    enabled: true,
                    branch: 'commercial',
                    quote_mode: 'manual_review',
                    manual_review_required: true,
                    estimated_total: null,
                    inputs: {
                        areas_to_clean: state.commercialPressure.areasToClean,
                        dimensions: state.commercialPressure.dimensions,
                        surface_type: state.commercialPressure.surfaceType,
                        condition: state.commercialPressure.condition,
                        access_constraints: state.commercialPressure.accessConstraints,
                        operating_constraints: state.commercialPressure.operatingConstraints
                    }
                }
                : {
                    enabled: true,
                    branch: 'residential',
                    quote_mode: 'exact',
                    manual_review_required: false,
                    estimated_total: roundMoney(state.addons.pressureWalls * pricingConfig.addons.pressure.rate * state.floors),
                    inputs: {
                        walls: state.addons.pressureWalls,
                        floors: state.floors
                    }
                };
        }

        if (state.services.gutter) {
            details.gutter = state.propertyType === 'com'
                ? {
                    enabled: true,
                    branch: 'commercial',
                    quote_mode: 'manual_review',
                    manual_review_required: true,
                    estimated_total: null,
                    inputs: {
                        building_height: state.commercialGutter.buildingHeight,
                        gutter_guards: state.commercialGutter.guards,
                        debris_level: state.commercialGutter.debrisLevel,
                        access_concerns: state.commercialGutter.accessConcerns,
                        roof_safety: state.commercialGutter.roofSafety
                    }
                }
                : {
                    enabled: true,
                    branch: 'residential',
                    quote_mode: 'exact',
                    manual_review_required: false,
                    estimated_total: roundMoney(state.addons.gutterWalls * pricingConfig.addons.gutter.rate * state.floors * pricingConfig.addons.gutter.multiplier),
                    inputs: {
                        walls: state.addons.gutterWalls,
                        floors: state.floors
                    }
                };
        }

        if (state.services.caulk) {
            details.caulk = state.propertyType === 'com'
                ? {
                    enabled: true,
                    branch: 'commercial',
                    quote_mode: 'manual_review',
                    manual_review_required: true,
                    estimated_total: null,
                    inputs: {
                        location: state.commercialCaulk.location,
                        surface_material: state.commercialCaulk.surfaceMaterial,
                        issue_type: state.commercialCaulk.issueType,
                        access_notes: state.commercialCaulk.accessNotes
                    }
                }
                : {
                    enabled: true,
                    branch: 'residential',
                    quote_mode: pricingConfig.addons.caulk.mode === 'interest-only' ? 'manual_review' : 'exact',
                    manual_review_required: pricingConfig.addons.caulk.mode === 'interest-only',
                    estimated_total: pricingConfig.addons.caulk.mode === 'interest-only' ? null : roundMoney(pricingConfig.addons.caulk.rate),
                    inputs: {}
                };
        }

        if (state.services.review) {
            details.review_request = {
                enabled: true,
                branch: state.propertyType === 'com' ? 'commercial' : 'residential',
                quote_mode: 'manual_review',
                manual_review_required: true,
                estimated_total: null,
                inputs: {
                    description: state.reviewRequest.description,
                    uploaded_photo_count: state.uploadedPhotos.length
                }
            };
        }
        return details;
    }

    function buildEstimateData(state, result) {
        var commercialDebris = [];
        if (state.commercial.constructionDebris.paintOverspray) commercialDebris.push('paint_overspray');
        if (state.commercial.constructionDebris.concreteDust) commercialDebris.push('concrete_dust');
        if (state.commercial.constructionDebris.adhesiveStickers) commercialDebris.push('adhesive_stickers');
        var commercialContext = buildCommercialContext(state, result);
        var serviceDetails = buildServiceDetails(state, result);
        return {
            source: 'estimate_request',
            property_type: state.propertyType,
            service_level: state.services.windows ? state.serviceLevel : '',
            service_level_label: state.services.windows ? buildServiceLevelLabel(state.propertyType, state.serviceLevel) : '',
            frequency: state.frequency.label,
            package_level: state.package.level,
            package_label: state.package.label,
            package_customized: isPackageCustomized(state),
            recurring_frequency: state.frequency.key,
            discount_applied: state.frequency.discountPercent,
            uploaded_photos: state.uploadedPhotos,
            floors: state.floors,
            total_windows: state.propertyType === 'com' ? (state.services.windows ? state.commercial.windowCount : 0) : result.totalWindows,
            window_counts: {
                double_hung: state.propertyType === 'res' ? state.windowCounts.doubleHung : 0,
                casement: state.propertyType === 'res' ? state.windowCounts.casement : 0,
                picture: state.propertyType === 'res' ? state.windowCounts.picture : 0,
                storm: state.propertyType === 'res' ? state.windowCounts.storm : 0,
                skylight: state.propertyType === 'res' ? state.windowCounts.skylight : 0
            },
            extras: {
                screens: state.propertyType === 'res' ? state.extras.screens : 0,
                tracks: state.propertyType === 'res' ? state.extras.tracks : 0,
                hard_water: state.propertyType === 'res' ? state.extras.hardWater : false,
                paint_debris: state.propertyType === 'res' ? state.extras.paintDebris : false,
                ladder_work: state.propertyType === 'res' ? state.extras.ladderWork : false,
                manual_skylight_cleaning: state.propertyType === 'res' ? state.extras.manualSkylightCleaning : false
            },
            addons: {
                pressure_washing: {
                    enabled: state.services.pressure,
                    walls: state.addons.pressureWalls
                },
                gutter_cleaning: {
                    enabled: state.services.gutter,
                    walls: state.addons.gutterWalls
                },
                caulking: {
                    enabled: state.services.caulk
                }
            },
            minimum_applied: result.minimumApplied,
            estimate_total: result.displayMode === 'exact' ? result.total : 0,
            line_items: result.lineItems.map(function (item) {
                return {
                    label: item.label,
                    amount: item.amount,
                    quote_only: item.quoteOnly,
                    display_amount: item.displayAmount || ''
                };
            }),
            service_details: serviceDetails,
            commercial: state.propertyType === 'com' && hasAnySelectedService(state.services) ? Object.assign({}, commercialContext || {}, state.services.windows ? {
                scope: state.commercial.scope,
                propertyType: state.commercial.propertyType,
                propertyUseType: state.commercial.propertyUseType,
                frequency: state.commercial.frequency,
                glassQuantityMode: state.commercial.glassQuantityMode,
                windowCount: state.commercial.windowCount,
                doors: state.commercial.doors,
                glassSqftRange: state.commercial.glassSqftRange,
                stories: state.commercial.stories,
                serviceLevel: state.commercial.serviceLevel,
                accessNotes: state.commercial.accessNotes,
                operatingConstraints: state.commercial.operatingConstraints,
                preferredServiceTime: state.commercial.preferredServiceTime,
                liftRequired: state.commercial.accessFlags.liftRequired,
                ropeAccessPossible: state.commercial.accessFlags.ropeAccessPossible,
                roofAccessAvailable: state.commercial.accessFlags.roofAccessAvailable,
                anchorPointsKnown: state.commercial.accessFlags.anchorPointsKnown,
                coiRequired: state.commercial.accessFlags.coiRequired,
                waterFedPolePossible: state.commercial.accessFlags.waterFedPolePossible,
                obstructionsPresent: state.commercial.accessFlags.obstructionsPresent,
                publicAccessConstraints: state.commercial.accessFlags.publicAccessConstraints,
                siteWalkRequired: state.commercial.accessFlags.siteWalkRequired,
                constructionDebris: commercialDebris,
                temperedGlassAcknowledged: state.commercial.temperedGlassAcknowledged,
                turnoverDate: state.commercial.turnoverDate,
                manualReviewRequired: !!result.hasManualReview || result.displayMode === 'manual_review',
                reviewStatus: result.displayMode,
                reviewReason: result.reviewReason || '',
                estimateBand: result.commercial && result.commercial.estimateBand ? result.commercial.estimateBand : (result.range ? result.displayTotalText : ''),
                estimatedTotal: result.displayMode === 'exact' ? result.total : null
            } : {}) : null
        };
    }

    function buildCompatiblePayload(state, result) {
        var createdAt = new Date().toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short'
        });
        var notes = state.notes;
        if (state.contact.businessName) {
            notes = 'Business / property name: ' + state.contact.businessName + (notes ? '\n\n' + notes : '');
        }
        var estimateData = buildEstimateData(state, result);

        var baseConfig = {
            form_type: state.propertyType === 'com' ? 'commercial' : 'residential',
            website: '',
            customer: {
                name: state.contact.name,
                phone: state.contact.phone,
                email: state.contact.email,
                address_line1: state.address.line1,
                city: state.address.city,
                state: state.address.state,
                postal_code: state.address.zip,
                best_time_to_reach: state.contact.bestTime,
                preferred_contact_method: state.contact.preferredContactMethod
            },
            request: {
                services: selectedServiceLabels(state),
                property_type: propertyTypeLabel(state.propertyType),
                customer_type: propertyTypeLabel(state.propertyType),
                frequency: state.frequency.label,
                recurring_frequency: state.frequency.key,
                discount_applied: state.frequency.discountPercent,
                notes: notes
            },
            estimate: estimateData,
            package_level: state.package.level,
            package_label: state.package.label,
            package_customized: isPackageCustomized(state),
            recurring_frequency: state.frequency.key,
            discount_applied: state.frequency.discountPercent,
            uploaded_photos: state.uploadedPhotos,
            commercial: state.propertyType === 'com' && hasAnySelectedService(state.services) ? estimateData.commercial : null,
            service_details: estimateData.service_details
        };

        var canonicalPayload = Submission && typeof Submission.buildSubmissionPayload === 'function'
            ? Submission.buildSubmissionPayload(baseConfig)
            : baseConfig;

        canonicalPayload.created_at = createdAt;
        canonicalPayload.business_name = state.contact.businessName;
        if (baseConfig.commercial) {
            canonicalPayload.commercial = baseConfig.commercial;
        }
        if (baseConfig.service_details) {
            canonicalPayload.service_details = baseConfig.service_details;
        }
        return canonicalPayload;
    }

    function renderReceipt(payload) {
        var commercialDetails = payload.commercial || (payload.estimate && payload.estimate.commercial) || null;
        var serviceDetails = payload.service_details || (payload.estimate && payload.estimate.service_details) || {};
        var isCommercial = payload.estimate.property_type === 'com';
        var requestItems = [
            ['Created', payload.created_at],
            ['Property type', payload.request.property_type],
            ['Address', [payload.customer.address_line1, payload.customer.city, payload.customer.state, payload.customer.postal_code].filter(Boolean).join(', ')],
            ['Services', payload.request.services.length ? payload.request.services.join(', ') : 'None selected'],
            ['Frequency', payload.request.frequency],
            [getPackageSummaryLabel(payload.estimate.property_type), payload.estimate.package_label || 'Not specified'],
            ['Recurring discount', payload.estimate.discount_applied ? payload.estimate.discount_applied + '% off' : 'No'],
            ['Service level', payload.estimate.service_level_label || 'Not specified']
        ];
        if (commercialDetails) {
            requestItems.push(['Commercial use', commercialDetails.propertyUseType || commercialDetails.property_use_type || commercialDetails.propertyType || 'Not provided']);
            requestItems.push(['Stories', commercialDetails.stories || 'Not provided']);
        }

        var contactItems = [
            ['Name', payload.customer.name || 'Not provided'],
            ['Business / property', payload.business_name || 'Not provided'],
            ['Phone', payload.customer.phone || 'Not provided'],
            ['Email', payload.customer.email || 'Not provided'],
            ['Preferred contact', payload.customer.preferred_contact_method || 'No preference'],
            ['Best time', payload.customer.best_time_to_reach || 'Any time']
        ];

        var estimateItems = payload.estimate.line_items.length
            ? payload.estimate.line_items.map(function (item) {
                return [
                    item.label,
                    item.display_amount || (item.quote_only ? 'Quoted separately' : money(item.amount))
                ];
            })
            : [['Estimate', 'No priced line items']];

        if (isCommercial && commercialDetails) {
            var commercialEstimateBand = commercialDetails.estimateBand || commercialDetails.estimate_band || '';
            var commercialEstimatedTotal = commercialDetails.estimatedTotal;
            if (commercialEstimatedTotal === undefined) commercialEstimatedTotal = commercialDetails.estimated_total;
            var commercialManualReview = !!(commercialDetails.manualReviewRequired || commercialDetails.manual_review_required);
            var commercialReviewReason = commercialDetails.reviewReason || commercialDetails.review_reason || '';
            if (commercialEstimateBand) {
                estimateItems.push(['Estimated range', commercialEstimateBand]);
            } else if (commercialEstimatedTotal !== null && commercialEstimatedTotal !== undefined) {
                estimateItems.push([commercialManualReview ? 'Estimated priced subtotal' : 'Estimated route price', money(commercialEstimatedTotal)]);
            }
            if (commercialManualReview) {
                estimateItems.push(['Review status', 'One or more selected services require review.']);
                estimateItems.push(['Reason', commercialReviewReason || 'We need to confirm access, property conditions, and service requirements.']);
            }
            if (!commercialEstimateBand && (commercialEstimatedTotal === null || commercialEstimatedTotal === undefined) && !commercialManualReview) {
                estimateItems.push(['Estimate status', 'Review required']);
            }
        } else {
            var hasReviewService = Object.keys(serviceDetails).some(function (key) {
                var detail = serviceDetails[key];
                return detail && detail.enabled && detail.quote_mode === 'manual_review';
            });
            var hasPricedLine = payload.estimate.line_items.some(function (item) {
                return !item.quote_only && Number(item.amount || 0) > 0;
            });
            if (hasReviewService && !hasPricedLine) {
                estimateItems.push(['Estimate status', 'Review required']);
            } else {
                estimateItems.push([hasReviewService ? 'Estimated priced subtotal' : 'Estimated total', money(payload.estimate.estimate_total)]);
            }
            estimateItems.push(['Minimum applied', payload.estimate.minimum_applied ? 'Yes' : 'No']);
        }

        Object.keys(serviceDetails).forEach(function (key) {
            var detail = serviceDetails[key];
            if (!detail || !detail.enabled) return;
            var label = key.replace(/_/g, ' ');
            var status = detail.quote_mode === 'range'
                ? (detail.estimate_band || 'Range pending')
                : (detail.quote_mode === 'exact'
                    ? money(detail.estimated_total || 0)
                    : 'Review required');
            estimateItems.push(['Service detail - ' + label, detail.branch + ' / ' + status]);
        });
        estimateItems.push(['Snapshot photos', payload.estimate.uploaded_photos && payload.estimate.uploaded_photos.length ? payload.estimate.uploaded_photos.length + ' attached' : 'None']);
        estimateItems.push(['Notes', payload.request.notes || 'None']);

        document.getElementById('receipt-request').innerHTML = renderReceiptList(requestItems);
        document.getElementById('receipt-contact').innerHTML = renderReceiptList(contactItems);
        document.getElementById('receipt-estimate').innerHTML = renderReceiptList(estimateItems);
    }

    function renderReceiptList(items) {
        return items.map(function (item) {
            return (
                '<li>' +
                '<span class="receipt-label">' + escapeHtml(item[0]) + '</span>' +
                '<span>' + escapeHtml(item[1]) + '</span>' +
                '</li>'
            );
        }).join('');
    }

    function clearSubmitFeedback() {
        if (!submitFeedbackEl) return;
        submitFeedbackEl.hidden = true;
        submitFeedbackEl.innerHTML = '';
    }

    function showSubmitFeedback(html) {
        if (!submitFeedbackEl) return;
        submitFeedbackEl.innerHTML = html;
        submitFeedbackEl.hidden = false;
        submitFeedbackEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function setSubmitBusy(isBusy) {
        if (!submitBtn) return;
        submitBtn.disabled = !!isBusy;
        submitBtn.textContent = isBusy ? 'Sending...' : submitBtnDefaultLabel;
    }

    function syncCommercialScopeDefaults(scope) {
        scope = scope || getSelectedCommercialScope();
        var serviceLevelField = getField('commercial_service_level');
        var quantityModeField = getField('commercial_glass_quantity_mode');
        if (!serviceLevelField || !quantityModeField) return;

        if (scope === 'storefront') {
            serviceLevelField.value = 'ext';
            if (!quantityModeField.value || quantityModeField.value === 'sqft_range') {
                quantityModeField.value = 'pane_count';
            }
            return;
        }

        serviceLevelField.value = 'both';
        if (!quantityModeField.value || quantityModeField.value === 'pane_count') {
            quantityModeField.value = 'sqft_range';
        }
    }

    function syncPanels(state) {
        var isCommercial = state.propertyType === 'com';
        var hasSelectedService = hasAnySelectedService(state.services);
        var hasResidentialMeasuredService = !isCommercial && (state.services.windows || state.services.pressure || state.services.gutter);
        var hasDetailSelection = hasSelectedService;
        setPanelState(serviceDetailPanel, hasSelectedService);
        setPanelState(commercialGeneralPanel, isCommercial && hasSelectedService);
        setPanelState(jobDetailsPanel, hasResidentialMeasuredService);
        setPanelState(frequencyFieldWrap, state.services.windows && !isCommercial);
        setPanelState(windowDetailsPanel, state.services.windows);
        setPanelState(pressureDetailsPanel, !isCommercial && state.services.pressure);
        setPanelState(gutterDetailsPanel, !isCommercial && state.services.gutter);
        setPanelState(caulkDetailsPanel, !isCommercial && state.services.caulk);
        setPanelState(commercialScopePanel, isCommercial && state.services.windows);
        setPanelState(commercialPressurePanel, isCommercial && state.services.pressure);
        setPanelState(commercialGutterPanel, isCommercial && state.services.gutter);
        setPanelState(commercialCaulkPanel, isCommercial && state.services.caulk);
        setPanelState(reviewRequestPanel, state.services.review);
        if (serviceDetailEmptyEl) {
            serviceDetailEmptyEl.hidden = hasDetailSelection;
        }

        businessNameField.hidden = state.propertyType !== 'com';
        contactNameLabel.innerHTML = state.propertyType === 'com'
            ? 'Contact person <span class="req">*</span>'
            : 'Your name <span class="req">*</span>';
        windowDetailsTitle.textContent = state.propertyType === 'com' ? 'Commercial window details' : 'Residential window details';
        windowDetailsCopy.textContent = state.propertyType === 'com'
            ? 'Choose the commercial scope that best matches the property so we can price storefront and low-rise work instantly and route complex access or post-construction jobs for review.'
            : 'Tell us how much glass needs attention and what condition it is in so we can build pricing for brighter, cleaner windows.';

        setPanelState(residentialPackageFieldset, !isCommercial && state.services.windows);
        setPanelState(residentialWindowFields, !isCommercial && state.services.windows);
        setPanelState(commercialWindowFields, isCommercial && state.services.windows);
        setPanelState(commercialStorefrontFields, isCommercial && state.services.windows && state.commercial.scope === 'storefront');
        setPanelState(commercialLowRiseFields, isCommercial && state.services.windows && state.commercial.scope === 'low_rise');
        setPanelState(commercialHighRiseFields, isCommercial && state.services.windows && state.commercial.scope === 'mid_high_rise');
        setPanelState(commercialPostConstructionFields, isCommercial && state.services.windows && state.commercial.scope === 'post_construction');
        setPanelState(countSkylightWrap, !isCommercial && state.services.windows);

        caulkPanelCopy.textContent = pricingConfig.addons.caulk.panelCopy;

        getField('service_windows').setAttribute('aria-expanded', String(!windowDetailsPanel.hidden));
        getField('service_pressure').setAttribute('aria-expanded', String(!pressureDetailsPanel.hidden));
        getField('service_gutter').setAttribute('aria-expanded', String(!gutterDetailsPanel.hidden));
        getField('service_caulk').setAttribute('aria-expanded', String(!caulkDetailsPanel.hidden));
        getField('service_review').setAttribute('aria-expanded', String(!reviewRequestPanel.hidden));
    }

    function updateServiceCards(state) {
        var residentialPrices = getWindowPrices('res');
        var residentialServiceLevelMultiplier = getServiceLevelMultiplier(getField('service_level').value || 'both');
        var minWindow = Math.min(residentialPrices.doubleHung, residentialPrices.casement, residentialPrices.picture, residentialPrices.storm);
        var maxWindow = Math.max(residentialPrices.doubleHung, residentialPrices.casement, residentialPrices.picture, residentialPrices.storm);
        var activeMinWindow = roundMoney(minWindow * residentialServiceLevelMultiplier);
        var activeMaxWindow = roundMoney(maxWindow * residentialServiceLevelMultiplier);
        var skylightRate = roundMoney(residentialPrices.skylight * residentialServiceLevelMultiplier);
        var extraRates = getExtraRates('res');
        var gutterEffectiveRate = roundMoney(pricingConfig.addons.gutter.rate * pricingConfig.addons.gutter.multiplier);

        if (state.propertyType === 'com') {
            var scopeMode = getCommercialScopeMode(state.commercial.scope);
            if (scopeMode === 'exact') {
                document.getElementById('service_windows_meta').textContent = 'Ground-level storefront route pricing with recurring discounts.';
                document.getElementById('service_windows_price').textContent = 'From ' + money(COMMERCIAL_PRICING.storefront.minimum);
                document.getElementById('service_windows_detail').textContent = 'Best for recurring customer-facing glass, entry doors, and low-risk route work.';
                setServiceInfoText('windows', 'Storefront glass and entry doors. Exact route pricing starts at the local minimum.');
            } else if (scopeMode === 'range') {
                document.getElementById('service_windows_meta').textContent = 'Estimate band based on glass size, access, and building layout.';
                document.getElementById('service_windows_price').textContent = formatEstimateBand(200, 350);
                document.getElementById('service_windows_detail').textContent = 'Best for office and facility glass where a quick range is useful before site confirmation.';
                setServiceInfoText('windows', 'Office or facility glass. Range depends on size, access, and layout.');
            } else if (scopeMode === 'site_review') {
                document.getElementById('service_windows_meta').textContent = 'Lift, rope, or high-access safety review required.';
                document.getElementById('service_windows_price').textContent = 'Review';
                document.getElementById('service_windows_detail').textContent = 'We need to confirm access, insurance, and jobsite requirements before final pricing.';
                setServiceInfoText('windows', 'High-access work needs safety, insurance, and access review.');
            } else {
                document.getElementById('service_windows_meta').textContent = 'Heavy debris and scraping-risk cleanup is reviewed manually.';
                document.getElementById('service_windows_price').textContent = 'Review';
                document.getElementById('service_windows_detail').textContent = 'Post-construction glass cleanup is scoped after we review debris, glass condition, and uploaded photos.';
                setServiceInfoText('windows', 'Debris and scraping-risk cleanup needs glass-condition review.');
            }
        } else {
            document.getElementById('service_windows_meta').textContent = getField('service_level').value === 'ext'
                ? 'Professional exterior-only service.'
                : 'Professional inside and out.';
            document.getElementById('service_windows_price').textContent = money(activeMinWindow) + ' to ' + money(activeMaxWindow);
            document.getElementById('service_windows_detail').textContent = 'Streak-free, spotless glass. Add screens and tracks here. Upload photos for stains, debris, skylights, or access questions.';
            setServiceInfoText('windows', getField('service_level').value === 'ext'
                ? 'Exterior glass. Upload photos for stains, debris, skylights, or access questions.'
                : 'Inside/outside glass. Upload photos for stains, debris, skylights, or access questions.');
        }

        document.getElementById('service_pressure_meta').textContent = state.propertyType === 'com'
            ? 'Commercial pressure washing is reviewed manually.'
            : 'Priced by wall count and floors.';
        document.getElementById('service_pressure_price').textContent = state.propertyType === 'com'
            ? 'Review'
            : money(pricingConfig.addons.pressure.rate) + ' / wall / floor';
        document.getElementById('service_pressure_detail').textContent = state.propertyType === 'com'
            ? 'Tell us the areas, surfaces, dimensions, and constraints so we can review the commercial washing scope.'
            : 'Perfect for siding, patios, and walkways that have lost their shine. We will wash away the grime safely and effectively.';
        setServiceInfoText('pressure', state.propertyType === 'com'
            ? 'Commercial washing is reviewed after areas, surfaces, dimensions, and access.'
            : 'Siding, patios, and walkways. Priced by walls and floors.');

        document.getElementById('service_gutter_meta').textContent = state.propertyType === 'com'
            ? 'Commercial gutter cleaning is reviewed manually.'
            : 'Priced by runs, floors, and scope.';
        document.getElementById('service_gutter_price').textContent = state.propertyType === 'com'
            ? 'Review'
            : money(gutterEffectiveRate) + ' / wall / floor';
        document.getElementById('service_gutter_detail').textContent = state.propertyType === 'com'
            ? 'Share building height, debris level, guards, and access concerns so we can review safety and scope.'
            : 'Protect your foundation and roofline. We will clear out the debris so everything flows exactly how it should.';
        setServiceInfoText('gutter', state.propertyType === 'com'
            ? 'Share height, debris, guards, and access so we can review safety.'
            : 'Clears debris to protect the roofline and foundation.');

        document.getElementById('service_caulk_meta').textContent = state.propertyType === 'com'
            ? 'Commercial sealing is reviewed manually.'
            : pricingConfig.addons.caulk.cardMeta;
        document.getElementById('service_caulk_price').textContent = state.propertyType === 'com'
            ? 'Review'
            : (pricingConfig.addons.caulk.mode === 'interest-only'
            ? pricingConfig.addons.caulk.displayPrice
            : pricingConfig.addons.caulk.displayPrice || money(pricingConfig.addons.caulk.rate));
        document.getElementById('service_caulk_detail').textContent = state.propertyType === 'com'
            ? 'Describe the commercial sealing location, material, issue type, and access so we can review the scope.'
            : 'Need some weatherproofing or a fresh seal? Add this to the list, and we will take a close look when we review your project.';
        setServiceInfoText('caulk', state.propertyType === 'com'
            ? 'Location, material, issue type, and access determine review.'
            : 'Weatherproofing and fresh seals. We review scope and access before pricing.');

        document.getElementById('service_review_meta').textContent = 'Manual recommendation after review.';
        document.getElementById('service_review_price').textContent = 'Review';
        document.getElementById('service_review_detail').textContent = 'Use this if you want us to recommend the best service path after seeing the property details and photos.';
        setServiceInfoText('review', 'Upload photos or describe the issue, and we will recommend the best service path.');

        document.getElementById('price_double_hung').textContent = money(roundMoney(residentialPrices.doubleHung * residentialServiceLevelMultiplier)) + ' each';
        document.getElementById('price_casement').textContent = money(roundMoney(residentialPrices.casement * residentialServiceLevelMultiplier)) + ' each';
        document.getElementById('price_picture').textContent = money(roundMoney(residentialPrices.picture * residentialServiceLevelMultiplier)) + ' each';
        document.getElementById('price_storm').textContent = money(roundMoney(residentialPrices.storm * residentialServiceLevelMultiplier)) + ' each';
        document.getElementById('price_skylight').textContent = money(skylightRate) + ' each';
        document.getElementById('price_screens').textContent = money(extraRates.screens) + ' each';
        document.getElementById('price_tracks').textContent = money(extraRates.tracks) + ' each';
    }

    function clearGroupErrors() {
        serviceGroupErrorEl.textContent = '';
        serviceGroupErrorEl.hidden = false;
        windowScopeErrorEl.textContent = '';
        windowScopeErrorEl.hidden = false;
        if (commercialScopeErrorEl) {
            commercialScopeErrorEl.textContent = '';
            commercialScopeErrorEl.hidden = false;
        }
        if (commercialQuantityErrorEl) {
            commercialQuantityErrorEl.textContent = '';
            commercialQuantityErrorEl.hidden = false;
        }
        if (commercialPostConstructionErrorEl) {
            commercialPostConstructionErrorEl.textContent = '';
            commercialPostConstructionErrorEl.hidden = false;
        }
    }

    function validateState(state, result) {
        clearAllErrors();
        clearGroupErrors();

        var ok = true;
        var phoneDigits = state.contact.phone.replace(/\D/g, '');
        if (phoneDigits.length === 11 && phoneDigits.charAt(0) === '1') {
            phoneDigits = phoneDigits.slice(1);
        }

        if (!state.address.line1) {
            setFieldError('address_line1', 'Please enter the service address.');
            ok = false;
        }
        if (!state.address.city) {
            setFieldError('city', 'Please enter the city.');
            ok = false;
        }
        if (!state.address.state || state.address.state.length < 2) {
            setFieldError('state', 'Please enter the 2-letter state.');
            ok = false;
        }
        if (!/^\d{5}(?:-\d{4})?$/.test(state.address.zip)) {
            setFieldError('zip', 'Please enter a valid ZIP code.');
            ok = false;
        }
        if (!selectedServiceLabels(state).length) {
            serviceGroupErrorEl.textContent = 'Please select at least one service.';
            ok = false;
        }
        if (state.propertyType === 'com' && hasAnySelectedService(state.services) && !state.commercial.propertyUseType) {
            setFieldError('commercial_property_use_type', 'Please choose the property use type.');
            ok = false;
        }
        if (isReviewOnlySelection(state.services) && !state.reviewRequest.description && !state.uploadedPhotos.length) {
            setFieldError('review_request_description', 'Please add a short description or upload at least one photo.');
            ok = false;
        }
        if (!state.contact.name) {
            setFieldError('contact_name', state.propertyType === 'com' ? 'Please enter the contact person.' : 'Please enter your name.');
            ok = false;
        }
        if (state.propertyType === 'com' && !state.contact.businessName) {
            setFieldError('business_name', 'Please enter the business or property name.');
            ok = false;
        }
        if (!phoneDigits && !state.contact.email) {
            setFieldError('phone', 'Please provide a phone number or email address.');
            setFieldError('email', 'Please provide an email address or phone number.');
            ok = false;
        } else {
            if (phoneDigits && phoneDigits.length !== 10) {
                setFieldError('phone', 'Please enter a valid 10-digit phone number.');
                ok = false;
            }
            if (state.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.contact.email)) {
                setFieldError('email', 'Please enter a valid email address.');
                ok = false;
            }
        }

        if (state.services.windows) {
            if (state.propertyType === 'res') {
                var hasWindowScope = result.totalWindows > 0
                    || state.extras.screens > 0
                    || state.extras.tracks > 0;
                if (!hasWindowScope) {
                    windowScopeErrorEl.textContent = 'Add at least one window, screen, track, or related window detail for window cleaning.';
                    ok = false;
                }
            } else {
                var hasPostConstructionDebris = state.commercial.constructionDebris.paintOverspray
                    || state.commercial.constructionDebris.concreteDust
                    || state.commercial.constructionDebris.adhesiveStickers;

                if (!state.commercial.scope) {
                    commercialScopeErrorEl.textContent = 'Please choose the commercial project type.';
                    ok = false;
                }
                if (!state.commercial.frequency) {
                    setFieldError('commercial_frequency', 'Please choose a service frequency.');
                    ok = false;
                }
                if (!state.commercial.glassQuantityMode) {
                    setFieldError('commercial_glass_quantity_mode', 'Please choose how you want to estimate the glass quantity.');
                    ok = false;
                }
                if (state.commercial.scope === 'storefront' && state.commercial.windowCount <= 0 && state.commercial.doors <= 0) {
                    setFieldError('commercial_window_count', 'Please enter pane, section, or door counts for storefront pricing.');
                    ok = false;
                }
                if (state.commercial.scope === 'low_rise' && !state.commercial.glassSqftRange) {
                    setFieldError('commercial_glass_sqft_range', 'Please select a glass size range or upload photos for review.');
                    ok = false;
                }
                if (!state.commercial.accessNotes) {
                    setFieldError('commercial_access_notes', 'Please add access notes so we can review the property correctly.');
                    ok = false;
                }
                if (state.commercial.scope === 'mid_high_rise' && !state.commercial.accessNotes) {
                    setFieldError('commercial_access_notes', 'High-access jobs require access notes before we can review the estimate.');
                    ok = false;
                }
                if (state.commercial.scope === 'post_construction') {
                    if (!hasPostConstructionDebris) {
                        commercialPostConstructionErrorEl.textContent = 'Please select the post-construction debris or cleanup condition.';
                        ok = false;
                    }
                    if (!state.commercial.temperedGlassAcknowledged) {
                        commercialPostConstructionErrorEl.textContent = 'Please acknowledge the tempered glass warning before requesting post-construction cleanup.';
                        ok = false;
                    }
                }
            }
        }

        if (state.propertyType === 'com' && state.services.pressure) {
            if (!state.commercialPressure.areasToClean) {
                setFieldError('commercial_pressure_areas_to_clean', 'Please describe the commercial pressure washing areas.');
                ok = false;
            }
            if (!state.commercialPressure.surfaceType) {
                setFieldError('commercial_pressure_surface_type', 'Please choose the surface type.');
                ok = false;
            }
        }

        if (state.propertyType === 'com' && state.services.gutter) {
            if (!state.commercialGutter.buildingHeight) {
                setFieldError('commercial_gutter_building_height', 'Please choose the building height.');
                ok = false;
            }
            if (!state.commercialGutter.debrisLevel) {
                setFieldError('commercial_gutter_debris_level', 'Please choose the debris level.');
                ok = false;
            }
        }

        if (state.propertyType === 'com' && state.services.caulk) {
            if (!state.commercialCaulk.location) {
                setFieldError('commercial_caulk_location', 'Please describe where sealing is needed.');
                ok = false;
            }
            if (!state.commercialCaulk.issueType) {
                setFieldError('commercial_caulk_issue_type', 'Please choose the sealing issue type.');
                ok = false;
            }
        }

        var COUNT_INPUTS = [
            'count_double_hung', 'count_casement', 'count_picture',
            'count_storm', 'count_skylight', 'screens', 'tracks'
        ];
        if (state.propertyType === 'res' && state.services.windows) {
            COUNT_INPUTS.forEach(function (id) {
                if (countValue(fieldValue(id)) > 999) {
                    setFieldError(id, 'Please enter a value of 999 or less.');
                    ok = false;
                }
            });
        }
        if (state.propertyType === 'com' && state.services.windows && state.commercial.scope === 'storefront') {
            ['commercial_window_count', 'commercial_doors'].forEach(function (id) {
                if (countValue(fieldValue(id)) > 9999) {
                    setFieldError(id, 'Please enter a value of 9,999 or less.');
                    ok = false;
                }
            });
        }

        if (!state.consent) {
            setFieldError('consent', 'Please confirm that we may contact you about the estimate.');
            ok = false;
        }

        return ok;
    }

    function focusFirstError() {
        var firstField = form.querySelector('.input-error');
        if (firstField && typeof firstField.focus === 'function') {
            firstField.focus();
            firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        var firstGroupError = form.querySelector('.group-error:not([hidden])');
        if (firstGroupError) {
            firstGroupError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function formatPhoneInput() {
        var field = getField('phone');
        var digits = field.value.replace(/\D/g, '');
        if (digits.length === 11 && digits.charAt(0) === '1') {
            digits = digits.slice(1);
        }
        if (digits.length !== 10) {
            field.value = trim(field.value);
            return;
        }
        field.value = '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
    }

    function applyAddressSuggestion(suggestion) {
        if (!suggestion || typeof suggestion !== 'object') return;
        var line1 = trim(suggestion.address_line1 || suggestion.label);
        getField('address_line1').value = line1;
        getField('city').value = trim(suggestion.city) || 'Manual entry';
        getField('state').value = stateCode(suggestion.state || 'WI');
        getField('zip').value = trim(suggestion.postal_code) || '00000';
        selectedAddressLabel = trim(suggestion.label);
        selectedAddressLine1 = line1;
        clearFieldError('address_line1');
        clearFieldError('city');
        clearFieldError('state');
        clearFieldError('zip');
        updateAll();
    }

    function queueAddressLookup() {
        var query = trim(getField('address_line1').value);
        selectedAddressLabel = '';
        selectedAddressLine1 = '';
        if (addressLookupTimer) window.clearTimeout(addressLookupTimer);
        if (query.length < 5) return;
        addressLookupTimer = window.setTimeout(function () {
            fetch('/api/address-search?q=' + encodeURIComponent(query), { headers: { Accept: 'application/json' } })
                .then(function (response) { return response.ok ? response.json() : { results: [] }; })
                .then(function (data) {
                    var list = document.getElementById('estimate-address-suggestions');
                    if (!list) return;
                    addressSuggestionMap = {};
                    list.innerHTML = (data.results || []).slice(0, 5).map(function (item) {
                        var label = trim(item.label || item.display_name);
                        if (!label) return '';
                        addressSuggestionMap[label] = item;
                        return '<option value="' + escapeHtml(label) + '"></option>';
                    }).join('');
                })
                .catch(function () {
                    addressSuggestionMap = {};
                });
        }, 240);
    }

    function handleAddressSelection() {
        var value = trim(getField('address_line1').value);
        if (addressSuggestionMap[value]) {
            applyAddressSuggestion(addressSuggestionMap[value]);
        }
    }

    function compressImageFile(file) {
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
                    var width = Math.max(1, Math.round(img.width * ratio));
                    var height = Math.max(1, Math.round(img.height * ratio));
                    var canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    var context = canvas.getContext('2d');
                    if (!context) {
                        resolve(null);
                        return;
                    }
                    context.drawImage(img, 0, 0, width, height);
                    var dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                    if (dataUrl.length > 190000) {
                        dataUrl = canvas.toDataURL('image/jpeg', 0.38);
                    }
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

    function handleSnapshotPhotos() {
        var input = getField('snapshot_photos');
        var status = document.getElementById('snapshot_photo_status');
        if (!input) return;
        var files = Array.prototype.slice.call(input.files || [], 0, 3);
        snapshotPhotos = [];
        if (!files.length) {
            if (status) status.textContent = 'Attach up to 3 quick photos for a faster review. If hard water, paint, debris, skylights, or access issues affect the job, we will confirm that directly before final pricing.';
            updateAll();
            return;
        }
        if (status) status.textContent = 'Compressing ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '...';
        Promise.all(files.map(compressImageFile)).then(function (items) {
            snapshotPhotos = items.filter(Boolean);
            if (status) {
                status.textContent = snapshotPhotos.length
                    ? snapshotPhotos.length + ' photo' + (snapshotPhotos.length === 1 ? '' : 's') + ' ready for the quote request.'
                    : 'Photos could not be compressed, but you can still submit the request.';
            }
            updateAll();
        });
    }

    function updateAll() {
        var state = normalizeState(readState());
        syncPanels(state);
        updateServiceCards(state);
        renderCart(state, calculateEstimate(state));
        return state;
    }

    function handleFieldInput(event) {
        var target = event.target;
        if (!target || !target.id) {
            updateAll();
            return;
        }

        if (target.name === 'package_level_res') {
            applyPackagePreset(target.value);
            return;
        }

        if (target.name === 'commercial_scope') {
            syncCommercialScopeDefaults(target.value);
            clearGroupErrors();
            updateAll();
            return;
        }

        if (!syncingPackagePreset && target.id === 'screens') {
            screensManuallyEdited = true;
        }
        if (!syncingPackagePreset && target.id === 'tracks') {
            tracksManuallyEdited = true;
        }

        if (/^count_/.test(target.id)) {
            syncPackageCounts();
        }

        if (target.name === 'property_type') {
            clearGroupErrors();
            if (target.value === 'res') {
                applyPackagePreset(getSelectedPackageLevel());
                return;
            }
            syncCommercialScopeDefaults(getSelectedCommercialScope());
            updateAll();
            return;
        }

        if (target.id === 'phone') {
            clearFieldError('phone');
            clearFieldError('email');
        } else if (target.id === 'email') {
            clearFieldError('phone');
            clearFieldError('email');
        } else {
            clearFieldError(target.id);
        }

        if (target.name === 'services') {
            clearGroupErrors();
        }

        if (/^commercial_/.test(target.id)) {
            clearGroupErrors();
        }

        updateAll();
    }

    function normalizePricingConfig(raw) {
        var config = clone(DEFAULT_PRICING_CONFIG);
        config.addons.caulk.displayPrice = 'Quoted';
        config.addons.caulk.cardMeta = 'Custom priced after review.';
        config.addons.caulk.panelCopy = 'Need some weatherproofing or a fresh seal? Add this to the list, and we will take a close look when we review your project.';
        config.addons.caulk.lineItemCopy = 'Custom priced after review';
        if (!isPlainObject(raw)) {
            return config;
        }

        if (Number.isFinite(numberValue(raw.minimumCharge, NaN))) {
            config.minimumCharge = roundMoney(raw.minimumCharge);
        }

        if (isPlainObject(raw.serviceLevelMultipliers)) {
            if (Number.isFinite(numberValue(raw.serviceLevelMultipliers.both, NaN))) {
                config.serviceLevelMultipliers.both = numberValue(raw.serviceLevelMultipliers.both, 1);
            }
            if (Number.isFinite(numberValue(raw.serviceLevelMultipliers.ext, NaN))) {
                config.serviceLevelMultipliers.ext = numberValue(raw.serviceLevelMultipliers.ext, 0.6);
            }
        }

        if (Number.isFinite(numberValue(raw.packageMultiplier && raw.packageMultiplier.deluxe, NaN))) {
            config.packageMultiplier.deluxe = numberValue(raw.packageMultiplier.deluxe, config.packageMultiplier.deluxe);
        }

        ['res', 'com'].forEach(function (propertyType) {
            var sourceProperty = raw.propertyTypes && raw.propertyTypes[propertyType];
            if (!isPlainObject(sourceProperty)) {
                return;
            }

            var windowKeys = propertyType === 'res'
                ? RESIDENTIAL_WINDOW_KEYS
                : COMMERCIAL_WINDOW_KEYS;
            windowKeys.forEach(function (windowKey) {
                if (Number.isFinite(numberValue(sourceProperty.windows && sourceProperty.windows[windowKey], NaN))) {
                    config.propertyTypes[propertyType].windows[windowKey] = roundMoney(sourceProperty.windows[windowKey]);
                }
            });

            ['screens', 'tracks', 'upperFloorAccess'].forEach(function (extraKey) {
                if (Number.isFinite(numberValue(sourceProperty.extras && sourceProperty.extras[extraKey], NaN))) {
                    config.propertyTypes[propertyType].extras[extraKey] = roundMoney(sourceProperty.extras[extraKey]);
                }
            });
        });

        if (isPlainObject(raw.addons)) {
            if (Number.isFinite(numberValue(raw.addons.pressure && raw.addons.pressure.rate, NaN))) {
                config.addons.pressure.rate = roundMoney(raw.addons.pressure.rate);
            }
            if (Number.isFinite(numberValue(raw.addons.gutter && raw.addons.gutter.rate, NaN))) {
                config.addons.gutter.rate = roundMoney(raw.addons.gutter.rate);
            }
            if (Number.isFinite(numberValue(raw.addons.gutter && raw.addons.gutter.multiplier, NaN))) {
                config.addons.gutter.multiplier = numberValue(raw.addons.gutter.multiplier, config.addons.gutter.multiplier);
            }
            if (Number.isFinite(numberValue(raw.addons.caulk && raw.addons.caulk.rate, NaN))) {
                config.addons.caulk.rate = roundMoney(raw.addons.caulk.rate);
            }

            var rawCaulkMode = trim(raw.addons.caulk && raw.addons.caulk.mode).toLowerCase();
            if (rawCaulkMode === 'priced') {
                config.addons.caulk.mode = 'priced';
                config.addons.caulk.displayPrice = money(config.addons.caulk.rate);
                config.addons.caulk.cardMeta = 'Custom priced after review.';
                config.addons.caulk.panelCopy = 'Need some weatherproofing or a fresh seal? Add this to the list, and we will take a close look when we review your project.';
                config.addons.caulk.lineItemCopy = '';
            } else if (rawCaulkMode === 'per-hour') {
                config.addons.caulk.mode = 'interest-only';
                config.addons.caulk.displayPrice = money(config.addons.caulk.rate) + ' / hour';
                config.addons.caulk.cardMeta = 'Custom priced after review.';
                config.addons.caulk.panelCopy = 'Need some weatherproofing or a fresh seal? Add this to the list, and we will take a close look when we review your project.';
                config.addons.caulk.lineItemCopy = 'Custom priced after review';
            } else {
                config.addons.caulk.mode = 'interest-only';
            }
        }

        if (isPlainObject(raw.adjustments)) {
            var hardWaterMultiplier = numberValue(raw.adjustments.hardWater && raw.adjustments.hardWater.multiplier, NaN);
            if (!Number.isFinite(hardWaterMultiplier)) {
                var legacyHardWaterValue = numberValue(raw.adjustments.hardWater && raw.adjustments.hardWater.flat, NaN);
                if (Number.isFinite(legacyHardWaterValue) && legacyHardWaterValue > 0 && legacyHardWaterValue <= 5) {
                    hardWaterMultiplier = legacyHardWaterValue;
                }
            }
            if (Number.isFinite(hardWaterMultiplier)) {
                config.adjustments.hardWater.multiplier = hardWaterMultiplier;
            }

            ['paintDebris', 'ladderWork', 'manualSkylightCleaning'].forEach(function (adjustmentKey) {
                if (Number.isFinite(numberValue(raw.adjustments[adjustmentKey] && raw.adjustments[adjustmentKey].flat, NaN))) {
                    config.adjustments[adjustmentKey].flat = roundMoney(raw.adjustments[adjustmentKey].flat);
                }
            });
        }

        return config;
    }

    function loadPricingConfig() {
        return fetch('../pricing.json', { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Pricing config request failed with ' + response.status);
                }
                return response.json();
            })
            .then(function (config) {
                pricingConfig = normalizePricingConfig(config);
            })
            .catch(function (error) {
                console.warn('Using default estimate pricing config.', error);
                pricingConfig = clone(DEFAULT_PRICING_CONFIG);
                pricingConfig.addons.caulk.displayPrice = 'Quoted';
                pricingConfig.addons.caulk.cardMeta = 'Custom priced after review.';
                pricingConfig.addons.caulk.panelCopy = 'Need some weatherproofing or a fresh seal? Add this to the list, and we will take a close look when we review your project.';
                pricingConfig.addons.caulk.lineItemCopy = 'Custom priced after review';
            });
    }

    form.addEventListener('input', handleFieldInput);
    form.addEventListener('change', handleFieldInput);
    document.addEventListener('click', function (event) {
        var target = event.target;
        var trigger = target && target.closest ? target.closest('.info-trigger') : null;

        if (trigger) {
            event.preventDefault();
            event.stopPropagation();
            openInfoPopover(trigger);
            return;
        }

        if (infoPopoverEl && !infoPopoverEl.contains(target)) {
            closeInfoPopover();
        }
    }, true);
    document.addEventListener('keydown', function (event) {
        var target = event.target;
        var trigger = target && target.closest ? target.closest('.info-trigger') : null;
        if (trigger && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openInfoPopover(trigger);
            return;
        }

        if (event.key === 'Escape') {
            closeInfoPopover();
        }
    });
    window.addEventListener('resize', closeInfoPopover);
    window.addEventListener('scroll', closeInfoPopover, true);
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        clearSubmitFeedback();

        var state = normalizeState(readState());
        var result = calculateEstimate(state);

        if (!validateState(state, result)) {
            focusFirstError();
            return;
        }

        var payload = buildCompatiblePayload(state, result);
        window.fieldOpsDemoEstimateDemoPayload = payload;
        window.fieldOpsDemoEstimateDemoState = state;
        window.fieldOpsDemoEstimateDemoResult = result;
        if (Submission && typeof Submission.buildSendPayload === 'function') {
            window.fieldOpsDemoEstimateSendPayload = Submission.buildSendPayload(payload);
        }

        if (!Submission || typeof Submission.submitCanonicalRequest !== 'function') {
            showSubmitFeedback('We could not send your request right now. Please call <a href="' + FALLBACK_PHONE_HREF + '">' + FALLBACK_PHONE_DISPLAY + '</a> or email <a href="mailto:' + FALLBACK_EMAIL + '">' + FALLBACK_EMAIL + '</a>.');
            return;
        }

        setSubmitBusy(true);
        Submission.submitCanonicalRequest(payload, { endpoint: API_INTAKE })
            .then(function (res) {
                if (!res.ok) {
                    if (res.status === 429 && typeof Submission.buildRateLimitHtml === 'function') {
                        showSubmitFeedback(Submission.buildRateLimitHtml(res.error_message, res.retry_after, SUBMIT_UI));
                        return;
                    }

                    if (typeof Submission.buildSubmitErrorHtml === 'function') {
                        showSubmitFeedback(Submission.buildSubmitErrorHtml(res.error_message, SUBMIT_UI));
                        return;
                    }

                    showSubmitFeedback('We could not send your request right now. Please call <a href="' + FALLBACK_PHONE_HREF + '">' + FALLBACK_PHONE_DISPLAY + '</a> or email <a href="mailto:' + FALLBACK_EMAIL + '">' + FALLBACK_EMAIL + '</a>.');
                    return;
                }

                renderReceipt(payload);
                if (res.data && res.data.delivery_state === 'failed') {
                    var errEl = document.getElementById('receipt-send-error');
                    if (errEl) { errEl.hidden = false; }
                }
                estimateShell.hidden = true;
                receiptEl.hidden = false;
                stickyCartBar.hidden = true;
                receiptEl.focus();
                receiptEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            })
            .catch(function () {
                if (Submission && typeof Submission.buildSubmitErrorHtml === 'function') {
                    showSubmitFeedback(Submission.buildSubmitErrorHtml('', SUBMIT_UI));
                    return;
                }
                showSubmitFeedback('We could not send your request right now. Please call <a href="' + FALLBACK_PHONE_HREF + '">' + FALLBACK_PHONE_DISPLAY + '</a> or email <a href="mailto:' + FALLBACK_EMAIL + '">' + FALLBACK_EMAIL + '</a>.');
            })
            .finally(function () {
                setSubmitBusy(false);
            });
    });

    form.addEventListener('reset', function () {
        window.requestAnimationFrame(function () {
            clearAllErrors();
            clearGroupErrors();
            clearSubmitFeedback();
            screensManuallyEdited = false;
            tracksManuallyEdited = false;
            snapshotPhotos = [];
            selectedAddressLabel = '';
            selectedAddressLine1 = '';
            estimateShell.hidden = false;
            receiptEl.hidden = true;
            stickyCartBar.hidden = false;
            applyPackagePreset(getSelectedPackageLevel());
            syncCommercialScopeDefaults(getSelectedCommercialScope());
        });
    });

    var resetFormBtn = document.getElementById('reset-form-btn');
    if (resetFormBtn) {
        resetFormBtn.addEventListener('click', function () {
            if (!window.confirm('Reset the form? All your entries will be cleared.')) return;
            form.reset();
        });
    }

    getField('phone').addEventListener('blur', formatPhoneInput);
    getField('address_line1').addEventListener('input', queueAddressLookup);
    getField('address_line1').addEventListener('change', handleAddressSelection);
    getField('snapshot_photos').addEventListener('change', handleSnapshotPhotos);

    stickyCartButton.addEventListener('click', function () {
        estimateCartEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    estimateResetBtn.addEventListener('click', function () {
        form.reset();
        getField('service_windows').focus();
        estimateShell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    loadPricingConfig().finally(function () {
        applyPackagePreset(getSelectedPackageLevel());
        syncCommercialScopeDefaults(getSelectedCommercialScope());
        updateAll();
    });
})();
