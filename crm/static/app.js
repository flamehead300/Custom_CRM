const { useMemo, useState, useEffect, useRef, useCallback } = React;

// â”€â”€â”€ UTILITIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BASE = { labor: 0.80, admin: 0.09, marketing: 0.005, overhead: 0.001, ownerAdminOverride: 0.002, ownerMarketingOverride: 0.002 };

const BUSINESS = {
  name: 'FieldOps Demo',
  phone: '(555) 010-0000',
  email: 'hello@example.invalid',
  city: 'Demo City, ST 00000',
};
const DEFAULT_TRAVEL_ROUTING_SETTINGS = Object.freeze({
  homeBaseAddress: '100 Demo Way, Demo City, ST 00000',
  workerPickupAddress: '200 Service Yard, Demo City, ST 00000',
});
const CUSTOMER_MARKER_EMOJI_OPTIONS = [
  { value: '', label: 'Default Pin' },
  { value: 'ðŸ”´', label: 'ðŸ”´ Red Circle' },
  { value: 'ðŸŸ ', label: 'ðŸŸ  Orange Circle' },
  { value: 'ðŸŸ¡', label: 'ðŸŸ¡ Yellow Circle' },
  { value: 'ðŸŸ¢', label: 'ðŸŸ¢ Green Circle' },
  { value: 'ðŸ”µ', label: 'ðŸ”µ Blue Circle' },
  { value: 'ðŸŸ£', label: 'ðŸŸ£ Purple Circle' },
  { value: 'âš«', label: 'âš« Black Circle' },
  { value: 'âšª', label: 'âšª White Circle' },
  { value: 'ðŸ“', label: 'ðŸ“ Pin' },
  { value: 'ðŸ ', label: 'ðŸ  House' },
  { value: 'ðŸ¢', label: 'ðŸ¢ Office' },
  { value: 'ðŸª', label: 'ðŸª Store' },
  { value: 'ðŸªŸ', label: 'ðŸªŸ Window' },
  { value: 'ðŸ§½', label: 'ðŸ§½ Cleaning' },
  { value: 'ðŸ’§', label: 'ðŸ’§ Water' },
  { value: 'â­', label: 'â­ Star' },
];
const JSPDF_SRC = '/static/jspdf.umd.min.js';
const RECEIPT_LOGO_SRC = '';
const RECEIPT_STANDARD_SERVICE_LABELS = [
  'Interior/Exterior Cleaning',
  'Exterior Cleaning',
  'Interior Cleaning',
  'Pressure Washing/Soft Washing',
  'Screen Cleaning',
  'Hard Water Removal',
  'Construction/Paint Removal',
  'Gutter Cleaning',
  'Other:'
];
const RECEIPT_LAYOUT = {
  pageWidth: 612,
  leftLabelX: 28,
  leftValueStartX: 138,
  leftValueEndX: 330,
  rightColumnX: 354,
  rightTextX: 372,
  rightLineEndX: 576,
  infoStartY: 92,
  fieldRowHeight: 16,
  textLineHeight: 12,
  summaryGap: 12,
  copyBottomY: 332,
  footerTopY: 316,
  closeMarginThreshold: 24,
  attachmentLeftMargin: 36,
  attachmentRightMargin: 36,
  attachmentTopMargin: 46,
  attachmentBottomMargin: 42,
  attachmentLineHeight: 13,
};
let _receiptLogoPromise = null;
let _receiptMeasureCanvas = null;

function money(n) { return (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatCurrency(value) { return money(value); }
function smartTitleCase(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bNw\b/g, "NW")
    .replace(/\bNe\b/g, "NE")
    .replace(/\bSw\b/g, "SW")
    .replace(/\bSe\b/g, "SE")
    .replace(/\bApt\b/g, "Apt")
    .replace(/\bUnit\b/g, "Unit");
}
function pct(n) { return (n * 100).toFixed(1) + "%"; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10); }
function toLocalISODate(date = new Date()) { return new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10); }
function addressKey(address) { return String(address || "").trim().toLowerCase(); }
function normalizeTravelRoutingSettings(value) {
  const payload = (value && typeof value === 'object') ? value : {};
  return {
    homeBaseAddress: String(payload.homeBaseAddress || DEFAULT_TRAVEL_ROUTING_SETTINGS.homeBaseAddress).trim() || DEFAULT_TRAVEL_ROUTING_SETTINGS.homeBaseAddress,
    workerPickupAddress: String(payload.workerPickupAddress || DEFAULT_TRAVEL_ROUTING_SETTINGS.workerPickupAddress).trim() || DEFAULT_TRAVEL_ROUTING_SETTINGS.workerPickupAddress,
  };
}
function buildRouteAddress(streetAddress = '', cityStateZip = '') {
  const street = String(streetAddress || '').trim();
  const cityLine = String(cityStateZip || '').trim();
  if (!street) return '';
  if (!cityLine) return street;
  const normalizedStreet = street.toLowerCase();
  const normalizedCityLine = cityLine.toLowerCase();
  return normalizedStreet.includes(normalizedCityLine) ? street : `${street}, ${cityLine}`;
}
function summarizeRouteStop(address, fallback = 'Stop') {
  const parts = String(address || '').split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || fallback;
}
function buildTravelRouteLabel(homeBaseAddress, workerPickupAddress) {
  const homeLabel = summarizeRouteStop(homeBaseAddress, 'Home');
  const workerLabel = summarizeRouteStop(workerPickupAddress, 'Worker');
  return `${homeLabel} -> ${workerLabel} pickup -> customer`;
}
function roundToTenths(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}
function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function escapeHtml(text) { return String(text ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch])); }
function normalizeMarkerEmoji(value) { return String(value ?? "").trim().slice(0, 8); }
function buildCustomerMarkerIcon(markerEmoji) {
  const emoji = normalizeMarkerEmoji(markerEmoji);
  if (!emoji || typeof window === 'undefined' || !window.L) return null;
  return window.L.divIcon({
    className: 'customer-emoji-marker',
    html: `<div style="width:30px;height:30px;border-radius:999px;background:#fff;border:2px solid #2a5bbf;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(13,18,36,0.28);font-size:17px;line-height:1;">${escapeHtml(emoji)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
}
function parseCityStateZipParts(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return { city: '', state: '', zip: '' };
  if (raw.includes(',')) {
    const [cityPart, restPart] = raw.split(',', 2);
    const restTokens = String(restPart || '').trim().split(/\s+/).filter(Boolean);
    return {
      city: cityPart.trim(),
      state: restTokens[0] || '',
      zip: restTokens.slice(1).join(' '),
    };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  return {
    city: tokens.slice(0, Math.max(0, tokens.length - 2)).join(' '),
    state: tokens.length >= 2 ? tokens[tokens.length - 2] : (tokens[0] || ''),
    zip: tokens.length >= 3 ? tokens[tokens.length - 1] : '',
  };
}
const ESTIMATE_MESSAGE_BUSINESS_SUFFIXES = new Set([
  'LLC', 'INC', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'PLC',
  'GROUP', 'SERVICES', 'SERVICE', 'CLEANING', 'WINDOW', 'WINDOWS'
]);
function normalizeEstimateText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
function ensureEstimateSentence(value = '') {
  const text = normalizeEstimateText(value);
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
function getEstimateGreetingName(customerName = '') {
  const normalizedName = normalizeEstimateText(customerName);
  if (!normalizedName) return '';
  const parts = normalizedName.split(' ');
  if (parts.length < 2) return normalizedName;
  const lastToken = parts[parts.length - 1].replace(/[^A-Za-z]/g, '').toUpperCase();
  return lastToken && !ESTIMATE_MESSAGE_BUSINESS_SUFFIXES.has(lastToken)
    ? parts[parts.length - 1]
    : normalizedName;
}
function buildEstimateAddressBlock(streetAddress = '', cityStateZip = '') {
  const street = normalizeEstimateText(streetAddress);
  const rawLine = normalizeEstimateText(cityStateZip);
  const parsed = parseCityStateZipParts(rawLine);
  const stateZip = [parsed.state, parsed.zip].filter(Boolean).join(' ').trim();
  return {
    street,
    cityStateZipLine: [parsed.city, stateZip].filter(Boolean).join(', ').trim() || rawLine,
  };
}
function buildEstimateSelectedServices({ serviceLevel, windows, extras, addons, otherText, manualProposalLines = [] }) {
  const manualProposalServices = normalizeManualProposalLines(manualProposalLines)
    .filter(line => line.hasTitle && line.isValidAmount)
    .map(line => ensureEstimateSentence(line.description ? `${line.title} - ${line.description}` : line.title))
    .filter(Boolean);
  if (manualProposalServices.length > 0) {
    return manualProposalServices;
  }

  const serviceLines = [];
  const totalWindows = Object.values(windows || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const pushService = label => {
    const sentence = ensureEstimateSentence(label);
    if (sentence && !serviceLines.includes(sentence)) serviceLines.push(sentence);
  };

  if (totalWindows > 0 && serviceLevel === 'both') pushService('Interior / Exterior Window Cleaning');
  if (totalWindows > 0 && serviceLevel === 'ext') pushService('Exterior Window Cleaning');
  if ((Number(extras?.screens) || 0) > 0) pushService('Screen Cleaning');
  if ((Number(extras?.tracks) || 0) > 0) pushService('Track Cleaning');
  if ((Number(addons?.pressure) || 0) > 0) pushService('Pressure Washing / Soft Washing');
  if ((Number(addons?.gutter) || 0) > 0) pushService('Gutter Cleaning');
  if ((Number(extras?.hardWater) || 0) > 0) pushService('Hard Water Removal');
  if ((Number(extras?.paintDebris) || 0) > 0) pushService('Construction / Paint Removal');
  if ((Number(addons?.caulk) || 0) > 0) pushService('Caulking / Sealing');
  if ((Number(extras?.skylights) || 0) > 0) pushService('Manual Skylight Cleaning');
  if ((Number(extras?.ladderWork) || 0) > 0) pushService('Ladder Access');
  if ((Number(extras?.lightFixture) || 0) > 0) pushService('Light Fixture / Ceiling Fan / Vent Cleaning');

  normalizeEstimateText(otherText)
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .forEach(pushService);

  return serviceLines;
}
function buildEstimateOptionalNotes({ serviceLevel, windows, extras, customerNotes }) {
  const notes = [];
  const totalWindows = Object.values(windows || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const serviceNotes = ensureEstimateSentence(customerNotes);

  if (serviceNotes) notes.push(`Service Notes: ${serviceNotes}`);

  if ((Number(windows?.storm) || 0) === 0 && totalWindows > 0) {
    if (serviceLevel === 'both' && (Number(extras?.screens) || 0) > 0) {
      notes.push('This estimate includes screen cleaning and interior/exterior window cleaning. At this time, the estimate does not include storm windows.');
    } else {
      notes.push('At this time, the estimate does not include storm windows.');
    }
  }

  return notes;
}
function isNewCustomerEstimateType(estimateType) {
  return String(estimateType || '').trim().toLowerCase() === 'new';
}
function hasValidEstimateAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0;
}
function getEstimateHeadlineTotal({ estimateType, baseTotal, total }) {
  if (isNewCustomerEstimateType(estimateType) && hasValidEstimateAmount(baseTotal) && Number(baseTotal) > 0) {
    return Number(baseTotal);
  }
  return hasValidEstimateAmount(total) ? Number(total) : 0;
}
function getEstimateFinalTotalLabel(estimateType) {
  return isNewCustomerEstimateType(estimateType)
    ? 'Discounted Total'
    : 'Total Cost of Services';
}
function buildEstimateDiscountText(estimateType, baseTotal) {
  return isNewCustomerEstimateType(estimateType) && Number(baseTotal) > 0
    ? '10% OFF New Customer'
    : 'Not applied';
}
function composeCustomerEstimateMessage({
  customerName,
  streetAddress,
  cityStateZip,
  phone,
  estimateNumber,
  estimateDate,
  estimateType,
  serviceLevel,
  windows,
  extras,
  addons,
  otherText,
  customerNotes,
  manualProposalLines,
  baseTotal,
  total,
}) {
  const isNewCustomerEstimate = isNewCustomerEstimateType(estimateType);
  const headlineTotal = getEstimateHeadlineTotal({ estimateType, baseTotal, total });
  const finalTotal = hasValidEstimateAmount(total) ? Number(total) : 0;
  const greetingName = normalizeEstimateText(customerName) || 'Customer';
  const addressBlock = buildEstimateAddressBlock(streetAddress, cityStateZip);
  const normalizedManualProposalServices = normalizeManualProposalLines(manualProposalLines).filter(line => line.hasTitle && line.isValidAmount);
  const services = buildEstimateSelectedServices({ serviceLevel, windows, extras, addons, otherText, manualProposalLines });
  const optionalNotes = normalizedManualProposalServices.length > 0
    ? (ensureEstimateSentence(customerNotes) ? [`Service Notes: ${ensureEstimateSentence(customerNotes)}`] : [])
    : buildEstimateOptionalNotes({ serviceLevel, windows, extras, customerNotes });
  const lines = [
    `FieldOps Demo Estimate: ${money(headlineTotal)}`,
    '',
    `Hello ${greetingName},`,
    '',
    'This is Demo Owner with,',
    '',
    BUSINESS.name,
    'Professional, Affordable Window Cleaning',
    BUSINESS.phone,
    BUSINESS.email,
    '',
    'SERVICE ESTIMATE',
    `Estimate #: ${estimateNumber}`,
    `Date of Estimate: ${estimateDate}`,
    '',
    `Customer Name: ${normalizeEstimateText(customerName)}`,
    `Service Address: ${addressBlock.street}`,
    addressBlock.cityStateZipLine,
    `Phone: ${normalizeEstimateText(phone)}`,
    '',
    'Services Included:',
  ];

  if (services.length > 0) {
    services.forEach(service => lines.push(`\u2713 ${service}`));
  }

  if (optionalNotes.length > 0) {
    lines.push('');
    optionalNotes.forEach(note => lines.push(note));
  }

  lines.push('');

  if (isNewCustomerEstimate) {
    lines.push(`New Customer Discount: ${buildEstimateDiscountText(estimateType, baseTotal)}`);
    lines.push('');
  }

  lines.push(
    `${getEstimateFinalTotalLabel(estimateType)}: ${money(finalTotal)}`,
    '',
    'Thank you for considering FieldOps Demo. We truly appreciate the opportunity to earn your business.'
  );

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const ESTIMATE_PDF_WEBSITE = 'www.example.invalid';
const ESTIMATE_TAX_ENABLED = false;
const ESTIMATE_PDF_TERMS = Object.freeze([
  {
    title: 'Weather Permitting',
    text: 'Services are subject to weather conditions. We reserve the right to reschedule without penalty due to rain, high winds, lightning, or other unsafe conditions.',
  },
  {
    title: 'Satisfaction Guarantee',
    text: 'We stand behind our workmanship and strive to maintain the highest quality service. If you notice a mistake in our cleaning, please contact us, and we will happily return to fix it for free.',
  },
  {
    title: 'Validity',
    text: 'This estimate is valid for one year from the date of issue. Prices are subject to change after this period.',
  },
  {
    title: 'Payment Terms',
    text: 'Payment is due in full upon completion of services unless prior arrangements have been made. We accept Cash, Check, Zelle, Venmo, and major Credit Cards. A 3% processing fee may be added to credit card transactions. Local taxes may apply. Late payments may incur a 1.5% monthly fee at 2 months past due.',
  },
  {
    title: 'Access & Preparation',
    text: 'Customers agree to provide clear access to all windows. Prior to our arrival, please pull all blinds into the open (up) position and clear away any knick-knacks or fragile items from window sills. While our crew can assist in moving standard furniture, we will not move pianos, delicate antiques, or large, heavy objects requiring expert handling. If access is obstructed by such items, you acknowledge and accept the risk of liability or services may be limited.',
  },
  {
    title: 'Pre-existing Conditions',
    text: "FieldOps Demo is not liable for pre-existing damage to windows, screens, blinds, frames, or surrounding structures. This includes, but is not limited to: scratched glass, broken seals, oxidized frames, rotted wood, aftermarket window tint film, aged or broken blinds, torn screens, and brittle removable grids. We will attempt to notify you if we observe damage prior to beginning work, but due to the nature of the job, this isn't always possible. We will communicate honestly and take full responsibility only for damages we knowingly cause.",
  },
  {
    title: 'Scope of Work & Routine Cleaning',
    text: 'The quoted cost covers routine window cleaning utilizing industry-approved, safe methods (e.g., soft cloths, strip washers, squeegees, mild detergents). A basic window sill wipe-down is complimentary; however, detailed scrubbing of window frames and tracks is not included unless explicitly stated. Routine cleaning methods will not remove adhered debris such as hard water stains, artillery fungus spores, tree sap, paint, adhesives, varnish, mortar, or silicone.',
  },
  {
    title: 'Non-Routine Glass Restoration',
    text: 'If stubborn stains or construction debris are present, non-routine restoration methods (e.g., metal razor blades, acids, abrasives, or polishing compounds) are required. We will not use non-routine methods without first educating you on the options and risks and obtaining your explicit consent. Additional charges will be proposed for non-routine glass restoration.',
  },
  {
    title: 'Routine Gutter Cleaning & Non-Routine Gutter Repair',
    text: 'The quoted cost covers cleaning out gutter channels and flushing downspouts as needed. Additional charges may apply for gutters covered by guards or screens that were not visible or disclosed at the time of the estimate, or if gutters are frozen due to weather conditions. Please note that FieldOps Demo is not responsible for pre-existing structural issues with the gutter system, including but not limited to failing hangers, incorrect installation pitch, or severe age-related deterioration. We will attempt to notify you if we observe such issues. While our routine scope of work does not include repair or realignment, we can provide a separate estimate and billing for those repairs upon request.',
  },
  {
    title: 'Routine Pressure Washing & Non-Routine Pressure Cleaning',
    text: 'The quoted cost covers standard pressure washing services. FieldOps Demo is not responsible or liable for damage resulting from the washing of pre-existing deteriorating or compromised surfaces, including but not limited to aging concrete, pavement, wood, vinyl, or brick. Furthermore, we cannot guarantee the removal of, nor accept liability for, extremely hard-to-access build-up located behind siding, soffit, fascia, or other inaccessible structural compartments.',
  },
  {
    title: 'Routine Soft Washing & Non-Routine Soft Washing',
    text: 'The quoted cost covers standard soft washing using low pressure and targeted chemical applications. Prior to service, we will evaluate the material\'s condition and do our absolute best to educate you on whether our chemicals or low-pressure methods present a risk of damage to the material or structure. We cannot guarantee access to clean build-up behind installed structures, siding, soffit, fascia, or inside inaccessible compartments. We take extreme care to ensure we do not push water into these inaccessible areas. While we cannot guarantee that remnant clean water drips will not occur as the structure dries, if you contact us, we will happily return to clean up any drips free of charge. If we determine that your structure is too fragile and would be damaged by the washing process, we will inform you and refuse service for that specific area to protect your property; in such cases, we will reduce the bill for that unperformed service to zero, willingly absorbing the travel and gas costs incurred to arrive at the job.',
  },
]);
const ESTIMATE_PDF_PREPARATION_CHECKLIST = Object.freeze([
  'Protect your valuables: Please clear fragile items away from the window sills',
  'Pet Safety: Please secure pets in another room, outside, or off-site during our visit if possible. This helps keep them safe and allows us to work efficiently.',
  'Pre-Existing Damage: Please let us know about damaged screens, cracked glass, broken seals, tint film, or fragile window parts.',
  'Payment Terms: Payment is due upon completion unless other arrangements were made.',
]);
function formatEstimatePdfValidUntil(dateValue) {
  const parsedDate = new Date(dateValue || Date.now());
  const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const validUntil = new Date(safeDate);
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  return validUntil.toLocaleDateString('en-US');
}
const COMMERCIAL_ESTIMATE_VALID_DAYS = 30;
const COMMERCIAL_ESTIMATE_SCOPE_NOTE_TEXT = 'This estimate includes only the services listed above. Balcony glass, balcony railings, interior unit glass, restoration work, scraping, adhesive removal, construction debris removal, and inaccessible glass are excluded unless added in writing. Scheduling is subject to weather, access, and site conditions.';
const MANUAL_PROPOSAL_ALLOW_NEGATIVE_AMOUNTS = true;
const MANUAL_PROPOSAL_LARGE_AMOUNT_WARNING_THRESHOLD = 1000;
const MANUAL_PROPOSAL_RECOMMENDED_TITLE_LENGTH = 70;
const MANUAL_PROPOSAL_RECOMMENDED_DESCRIPTION_LENGTH = 160;
const MANUAL_PROPOSAL_VAGUE_TITLES = new Set(['service', 'misc', 'adjustment', 'custom']);
function isCommercialEstimatePdf(receiptOrForm = {}) {
  return String(receiptOrForm?.estimateType || '').trim().toLowerCase() === 'commercial';
}
function createManualProposalLine(overrides = {}) {
  return {
    id: overrides.id || uid(),
    title: String(overrides.title || ''),
    description: String(overrides.description || ''),
    amount: overrides.amount == null ? '' : String(overrides.amount),
  };
}
function parseMoneyInput(value) {
  const normalized = String(value ?? '').replace(/[$,\s]/g, '').trim();
  if (!normalized) return NaN;
  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue : NaN;
}
function normalizeManualProposalLines(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, index) => {
      const title = normalizeEstimateText(line?.title);
      const description = normalizeEstimateText(line?.description);
      const amountText = String(line?.amount ?? '').trim();
      const amountValue = parseMoneyInput(amountText);
      return {
        id: String(line?.id || `manual-proposal-line-${index}`),
        title,
        description,
        amount: amountText,
        amountValue,
        hasTitle: Boolean(title),
        hasDescription: Boolean(description),
        hasAmount: amountText !== '',
        hasContent: Boolean(title || description || amountText),
        isValidAmount: amountText !== '' && Number.isFinite(amountValue) && (MANUAL_PROPOSAL_ALLOW_NEGATIVE_AMOUNTS || amountValue >= 0),
      };
    })
    .filter(line => line.hasContent);
}
function getManualProposalLineTotal(lines = []) {
  return Math.round(normalizeManualProposalLines(lines).reduce((sum, line) => {
    return line.hasTitle && line.isValidAmount ? sum + line.amountValue : sum;
  }, 0) * 100) / 100;
}
function buildManualProposalPdfTableRows(lines = []) {
  return normalizeManualProposalLines(lines)
    .filter(line => line.hasTitle && line.isValidAmount)
    .map(line => ({
      service: line.title,
      description: ensureEstimateSentence(line.description),
      amountText: line.amountValue < 0
        ? `-${money(Math.abs(line.amountValue))}`
        : money(line.amountValue),
    }));
}
function buildManualProposalNotesBlock(lines = []) {
  const validLines = normalizeManualProposalLines(lines)
    .filter(line => line.hasTitle && line.isValidAmount);
  if (validLines.length === 0) return '';
  const formatSignedAmount = amount => (amount < 0 ? `-${money(Math.abs(amount))}` : money(amount));
  return [
    'Customer-Facing Estimate Lines:',
    ...validLines.map(line => (
      line.description
        ? `- ${line.title} | ${line.description} | ${formatSignedAmount(line.amountValue)}`
        : `- ${line.title} | ${formatSignedAmount(line.amountValue)}`
    )),
  ].join('\n');
}
function hasVagueManualProposalLineTitle(title = '') {
  const normalizedTitle = normalizeEstimateText(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return Boolean(normalizedTitle) && MANUAL_PROPOSAL_VAGUE_TITLES.has(normalizedTitle);
}
function getManualProposalLineWarnings(lines = []) {
  const normalizedLines = normalizeManualProposalLines(lines);
  const warnings = [];
  normalizedLines.forEach(line => {
    if (!line.hasTitle) return;
    if (hasVagueManualProposalLineTitle(line.title)) {
      warnings.push({
        id: `${line.id}-vague`,
        lineId: line.id,
        message: 'This line may look too vague on a customer-facing estimate. Consider using a more specific service title.',
      });
    }
    if (line.title.length > MANUAL_PROPOSAL_RECOMMENDED_TITLE_LENGTH) {
      warnings.push({
        id: `${line.id}-title-length`,
        lineId: line.id,
        message: `Service title is longer than the recommended ${MANUAL_PROPOSAL_RECOMMENDED_TITLE_LENGTH} characters.`,
      });
    }
    if (line.description.length > MANUAL_PROPOSAL_RECOMMENDED_DESCRIPTION_LENGTH) {
      warnings.push({
        id: `${line.id}-description-length`,
        lineId: line.id,
        message: `Description / notes are longer than the recommended ${MANUAL_PROPOSAL_RECOMMENDED_DESCRIPTION_LENGTH} characters.`,
      });
    }
    if (line.isValidAmount && Math.abs(line.amountValue) >= MANUAL_PROPOSAL_LARGE_AMOUNT_WARNING_THRESHOLD) {
      if (line.title.replace(/[^A-Za-z0-9]/g, '').length <= 6) {
        warnings.push({
          id: `${line.id}-short-title`,
          lineId: line.id,
          message: 'This line may look too vague on a customer-facing estimate. Consider using a more specific service title.',
        });
      }
      if (!line.hasDescription) {
        warnings.push({
          id: `${line.id}-missing-description`,
          lineId: line.id,
          message: 'Large proposal lines are easier for customers to approve when you include a short description / notes field.',
        });
      }
    }
  });
  return warnings;
}
function getEstimateValidUntilDateForType(estimateType, baseDate) {
  if (!isCommercialEstimatePdf({ estimateType })) {
    return formatEstimatePdfValidUntil(baseDate);
  }
  const parsedDate = new Date(baseDate || Date.now());
  const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const validUntil = new Date(safeDate);
  validUntil.setDate(validUntil.getDate() + COMMERCIAL_ESTIMATE_VALID_DAYS);
  return validUntil.toLocaleDateString('en-US');
}
function getEstimatePdfWindowSummary(windows = {}) {
  return Object.entries(windows || {})
    .filter(([, count]) => (Number(count) || 0) > 0)
    .map(([type]) => {
      const label = String(ESTIMATE_WINDOW_TYPES?.[type] || type || 'Window').toLowerCase();
      return `${label} windows`;
    })
    .join(', ');
}
function getEstimatePdfLineItemLabel(label = '') {
  const safeLabel = String(label || '').trim();
  const windowMatch = safeLabel.match(/^(.+?) Windows \(\d+\)$/i);
  if (windowMatch) return `${windowMatch[1]} Windows`;
  if (/^Screens \(\d+\)$/i.test(safeLabel)) return 'Screen Cleaning';
  if (/^Tracks \(\d+\)$/i.test(safeLabel)) return 'Track Cleaning';
  if (/^Upper-floor access \(.+\)$/i.test(safeLabel)) return 'Upper-floor Access';
  if (/^Caulking \/ Sealing \(.+\)$/i.test(safeLabel)) return 'Caulking / Sealing';
  if (/^Hard Water Removal \(.+\)$/i.test(safeLabel)) return 'Hard Water Removal';
  if (/^Construction\/Paint Removal \(.+\)$/i.test(safeLabel)) return 'Construction / Paint Removal';
  if (/^Ladder Access \(.+\)$/i.test(safeLabel)) return 'Ladder Access';
  if (safeLabel === 'Condition Adj.') return 'Condition Adjustment';
  if (safeLabel === 'Frequency Adj.') return 'Frequency Adjustment';
  if (safeLabel === 'Minimum charge adjustment') return 'Minimum Charge Adjustment';
  if (safeLabel.startsWith('Skylights Manual')) return 'Manual Skylight Cleaning';
  if (safeLabel.startsWith('Light Fixtures/Fans')) return 'Light Fixture / Ceiling Fan / Vent Cleaning';
  return safeLabel;
}
function getEstimatePdfItemDescription(item = {}, context = {}) {
  const label = String(item.label || '').trim();
  const serviceLevel = String(context.serviceLevel || '').trim().toLowerCase();
  const cleaningScope = serviceLevel === 'both'
    ? 'Complete interior and exterior window cleaning'
    : 'Exterior window cleaning';
  const windowMatch = label.match(/^(.+?) Windows \((\d+)\)$/i);
  if (windowMatch) {
    return `${cleaningScope}.`;
  }
  if (/^Screens \(/i.test(label)) return 'Deep washing of removable window screens included in this estimate.';
  if (/^Tracks \(/i.test(label)) return 'Detailed track cleaning for accessible debris and routine buildup.';
  if (/^Upper-floor access/i.test(label)) return 'Additional ladder and upper-floor access pricing for elevated service areas.';
  if (/^Pressure Washing$/i.test(label)) return 'Standard pressure washing service for the quoted surface area.';
  if (/^Gutter Cleaning$/i.test(label)) return 'Routine gutter channel cleaning and downspout flushing as needed.';
  if (/^Caulking \/ Sealing/i.test(label)) {
    return item.quoteOnly
      ? 'Requested caulking or sealing work will be scoped and quoted separately before any work begins.'
      : 'Caulking or sealing service based on the quoted labor allowance.';
  }
  if (/^Hard Water Removal/i.test(label)) return 'Restoration-focused cleaning for mineral staining and hard water buildup.';
  if (/^Construction\/Paint Removal/i.test(label)) return 'Additional restoration work for paint, debris, or post-construction residue.';
  if (/^Ladder Access/i.test(label)) return 'Additional setup for ladder-based access to difficult-to-reach service areas.';
  if (/^Skylights Manual/i.test(label)) return 'Manual skylight cleaning requiring separate access and handling.';
  if (/^Light Fixtures\/Fans/i.test(label)) return 'Cleaning for light fixtures, ceiling fans, or vents included with this estimate.';
  if (/^Condition Adj\./i.test(label)) return 'Pricing adjustment based on the current condition and soil level of the surfaces to be cleaned.';
  if (/^Minimum charge adjustment$/i.test(label)) return 'Adjustment applied to meet the current minimum service charge for the visit.';
  if (/^Frequency Adj\./i.test(label)) return 'Recurring service frequency discount reflected in the final estimate total.';
  const windowSummary = normalizeEstimateText(context.windowSummary);
  if (windowSummary) return `Service included as requested for ${windowSummary}.`;
  return 'Service included as requested and scoped during estimating.';
}
function buildEstimatePdfTableRows({
  lineItems = [],
  serviceLevel,
  windows,
  extras,
  addons,
  otherText,
  customerNotes,
}) {
  const rows = [];
  const customerNote = ensureEstimateSentence(customerNotes);
  const optionalNotes = buildEstimateOptionalNotes({
    serviceLevel,
    windows,
    extras,
    customerNotes: '',
  });
  const generalNotes = [];
  if (customerNote) generalNotes.push(`Customer Notes: ${customerNote}`);
  optionalNotes.forEach(note => {
    const sentence = ensureEstimateSentence(note);
    if (sentence) generalNotes.push(sentence);
  });
  const windowSummary = getEstimatePdfWindowSummary(windows);
  const addGeneralNotesToRow = row => {
    if (!row || generalNotes.length === 0 || row._generalNotesApplied) return;
    row.description = [row.description, ...generalNotes].filter(Boolean).join(' ');
    row._generalNotesApplied = true;
  };

  lineItems.forEach(item => {
    const amount = Number(item?.amount);
    if (!item?.quoteOnly && (!Number.isFinite(amount) || amount <= 0)) return;
    if (Number.isFinite(amount) && amount < 0) return;
    const row = {
      service: getEstimatePdfLineItemLabel(item.label),
      description: getEstimatePdfItemDescription(item, {
        serviceLevel,
        windows,
        extras,
        addons,
        windowSummary,
      }),
      amountText: item.quoteOnly ? 'Quoted Separately' : money(Math.abs(amount)),
      _generalNotesApplied: false,
    };
    rows.push(row);
  });

  normalizeEstimateText(otherText)
    .split(/[\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .forEach(service => {
      rows.push({
        service,
        description: 'Custom requested service to be scoped and confirmed before work begins.',
        amountText: 'Quoted Separately',
        _generalNotesApplied: false,
      });
    });

  if (rows.length > 0) addGeneralNotesToRow(rows[0]);
  return rows.map(({ _generalNotesApplied, ...row }) => row);
}
function buildEstimatePdfAdjustmentLines({ estimateType, baseTotal, total, lineItems = [] }) {
  const adjustmentLines = [];
  const pushAdjustment = (label, amount) => {
    const numericAmount = Math.round((Number(amount) || 0) * 100) / 100;
    if (Math.abs(numericAmount) < 0.01) return;
    adjustmentLines.push({ label, amount: numericAmount });
  };

  lineItems.forEach(item => {
    const label = String(item?.label || '').trim();
    const amount = Number(item?.amount);
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.01) return;
    if (label === '10% OFF New Customer') {
      pushAdjustment('New Customer Discount (10% OFF)', amount);
      return;
    }
    if (label === 'Frequency Adj.') {
      pushAdjustment(amount < 0 ? 'Frequency Discount' : 'Frequency Adjustment', amount);
      return;
    }
    if (label === 'Minimum charge adjustment') {
      pushAdjustment('Minimum Charge Adjustment', amount);
    }
  });

  const trackedAmount = adjustmentLines.reduce((sum, item) => sum + item.amount, 0);
  const safeBaseTotal = hasValidEstimateAmount(baseTotal) ? Number(baseTotal) : 0;
  const safeTotal = hasValidEstimateAmount(total) ? Number(total) : 0;
  const remainder = Math.round((safeTotal - safeBaseTotal - trackedAmount) * 100) / 100;
  if (Math.abs(remainder) >= 0.01) {
    pushAdjustment(remainder < 0 ? 'Estimate Discount' : 'Estimate Adjustment', remainder);
  }
  return adjustmentLines;
}
function renderEstimatePdfDocument({ doc, receipt, logoImage, pageWidth, pageHeight }) {
  const marginX = 42;
  const topMargin = 40;
  const bottomMargin = 42;
  const contentWidth = pageWidth - (marginX * 2);
  const colors = {
    text: [31, 41, 55],
    muted: [100, 116, 139],
    border: [203, 213, 225],
    light: [243, 244, 246],
    blue: [37, 99, 235],
    softBlue: [239, 246, 255],
    softGray: [248, 250, 252],
    darkBlue: [30, 58, 138],
  };
  const safeText = value => value == null ? '' : String(value);
  const isCommercialEstimate = isCommercialEstimatePdf(receipt);
  const setTextStyle = ({ size = 10, font = 'helvetica', style = 'normal', color = colors.text } = {}) => {
    doc.setFont(font, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const wrapLines = (text, width, { size = 10, style = 'normal' } = {}) => {
    setTextStyle({ size, style });
    return wrapReceiptTextLines(text, width, value => doc.getTextWidth(String(value || '')));
  };
  const clampLines = (lines, maxLines) => {
    const safeLines = Array.isArray(lines) ? lines.filter(line => line != null) : [];
    if (safeLines.length <= maxLines) return safeLines;
    const nextLines = safeLines.slice(0, maxLines);
    const lastIndex = nextLines.length - 1;
    const trimmed = String(nextLines[lastIndex] || '').trim();
    nextLines[lastIndex] = trimmed ? `${trimmed.replace(/[. ]+$/g, '')}...` : '...';
    return nextLines;
  };
  const drawRule = (y, color = colors.border, width = 0.8) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(width);
    doc.line(marginX, y, pageWidth - marginX, y);
  };
  const drawHeaderBadge = () => {
    const badgeX = pageWidth - marginX - 112;
    const badgeY = topMargin - 2;
    if (logoImage) {
      const maxWidth = 112;
      const maxHeight = 62;
      const aspectRatio = logoImage.naturalWidth && logoImage.naturalHeight
        ? logoImage.naturalWidth / logoImage.naturalHeight
        : 1.5;
      let logoWidth = maxWidth;
      let logoHeight = logoWidth / aspectRatio;
      if (logoHeight > maxHeight) {
        logoHeight = maxHeight;
        logoWidth = logoHeight * aspectRatio;
      }
      doc.addImage(logoImage, 'PNG', pageWidth - marginX - logoWidth, badgeY, logoWidth, logoHeight);
      return;
    }
    doc.setFillColor(...colors.blue);
    doc.rect(badgeX, badgeY + 8, 112, 48, 'F');
    doc.setFillColor(255, 255, 255);
    doc.circle(badgeX + 22, badgeY + 32, 11, 'F');
    setTextStyle({ size: 13, style: 'bold', color: [255, 255, 255] });
    doc.text('FIELDOPS DEMO', badgeX + 60, badgeY + 30, { align: 'center' });
    setTextStyle({ size: 8, style: 'normal', color: [219, 234, 254] });
    doc.text('SERVICE ESTIMATE', badgeX + 60, badgeY + 43, { align: 'center' });
  };
  const drawHeader = () => {
    setTextStyle({ size: 20, style: 'bold', color: [17, 24, 39] });
    doc.text(BUSINESS.name, marginX, topMargin + 6);
    setTextStyle({ size: 9.5, style: 'italic', color: colors.muted });
    doc.text('Professional, Affordable Window Cleaning', marginX, topMargin + 21);
    setTextStyle({ size: 9.3, style: 'normal', color: colors.text });
    doc.text(`Phone: ${BUSINESS.phone}`, marginX, topMargin + 40);
    doc.text(`Email: ${BUSINESS.email}`, marginX, topMargin + 52);
    doc.text(`Web: ${ESTIMATE_PDF_WEBSITE}`, marginX, topMargin + 64);
    drawHeaderBadge();
    drawRule(topMargin + 78, colors.blue, 1.5);
    return topMargin + 92;
  };
  const drawMetaBlock = currentY => {
    const detailsBoxWidth = 184;
    const detailsX = pageWidth - marginX - detailsBoxWidth;
    const leftWidth = detailsX - marginX - 24;
    const parsedAddress = parseCityStateZipParts(receipt.cityStateZip);
    const addressLines = [
      normalizeEstimateText(receipt.address),
      [parsedAddress.city, [parsedAddress.state, parsedAddress.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    ].filter(Boolean);
    const customerLines = [
      normalizeEstimateText(receipt.customerName) || 'Customer',
      ...addressLines,
      `Phone: ${normalizeEstimateText(receipt.phone)}`,
    ];

    setTextStyle({ size: 9, style: 'bold', color: colors.muted });
    doc.text('ESTIMATE FOR', marginX, currentY);
    setTextStyle({ size: 14, style: 'bold' });
    doc.text(customerLines[0], marginX, currentY + 18);
    let lineY = currentY + 32;
    setTextStyle({ size: 9.4, style: 'normal', color: colors.text });
    customerLines.slice(1).forEach(line => {
      const wrappedLines = wrapLines(line, leftWidth, { size: 9.4 });
      wrappedLines.forEach(wrappedLine => {
        doc.text(wrappedLine, marginX, lineY);
        lineY += 12;
      });
      lineY += 1;
    });

    const estimateDate = safeText(receipt.date) || new Date().toLocaleDateString('en-US');
    const validUntilDate = safeText(receipt.validUntilDate) || getEstimateValidUntilDateForType(receipt.estimateType, estimateDate);
    const detailsRows = [
      ['Estimate #:', safeText(receipt.id)],
      ['Date:', estimateDate],
      ['Valid Until:', validUntilDate],
    ];
    const boxHeight = 74;
    doc.setFillColor(...colors.light);
    doc.setDrawColor(...colors.border);
    doc.rect(detailsX, currentY - 14, detailsBoxWidth, boxHeight, 'FD');
    let detailY = currentY + 2;
    detailsRows.forEach(([label, value], index) => {
      setTextStyle({ size: 9.2, style: 'bold', color: colors.muted });
      doc.text(label, detailsX + 14, detailY);
      setTextStyle({ size: 9.4, style: index === 0 ? 'bold' : 'normal', color: colors.text });
      doc.text(value || '-', detailsX + detailsBoxWidth - 14, detailY, { align: 'right' });
      detailY += 18;
    });

    return Math.max(lineY, currentY + boxHeight) + 12;
  };
  const hasEstimateTableRowsOverride = hasOwn(receipt || {}, 'estimateTableRows');
  const tableRows = hasEstimateTableRowsOverride
    ? (Array.isArray(receipt.estimateTableRows) ? receipt.estimateTableRows : [])
    : buildEstimatePdfTableRows({
      lineItems: receipt.estimateLineItems,
      serviceLevel: receipt.serviceLevel,
      windows: receipt.windows,
      extras: receipt.extras,
      addons: receipt.addons,
      otherText: receipt.otherText,
      customerNotes: receipt.customerNotes,
    });
  const subtotal = hasValidEstimateAmount(receipt.baseTotal) ? Number(receipt.baseTotal) : 0;
  const taxAmount = hasValidEstimateAmount(receipt.taxAmount) ? Number(receipt.taxAmount) : 0;
  const showTaxRow = ESTIMATE_TAX_ENABLED && taxAmount > 0;
  const totalAmount = hasValidEstimateAmount(receipt.total) ? Number(receipt.total) : subtotal;
  const hasEstimateAdjustmentLinesOverride = hasOwn(receipt || {}, 'estimateAdjustmentLines');
  const adjustmentLines = hasEstimateAdjustmentLinesOverride
    ? (Array.isArray(receipt.estimateAdjustmentLines) ? receipt.estimateAdjustmentLines : [])
    : buildEstimatePdfAdjustmentLines({
      estimateType: receipt.estimateType,
      baseTotal: subtotal,
      total: totalAmount,
      lineItems: receipt.estimateLineItems,
    });
  const hideSubtotal = receipt?.hideEstimateSubtotal === true;
  const buildEstimatePreparationChecklistLayout = width => {
    const introText = 'To help us complete your service safely and efficiently, please review the following before we arrive:';
    const introFontSize = 9.1;
    const introLineHeight = 10.8;
    const itemFontSize = 8.9;
    const itemLineHeight = 10.4;
    const introLines = wrapLines(introText, width - 28, { size: introFontSize });
    const items = ESTIMATE_PDF_PREPARATION_CHECKLIST.map(text => clampLines(
      wrapLines(text, width - 50, { size: itemFontSize }),
      3
    ));
    const contentHeight = 18
      + 16
      + (introLines.length * introLineHeight)
      + 12
      + items.reduce((sum, lines) => sum + Math.max(14, lines.length * itemLineHeight) + 6, 0)
      + 14;
    return {
      introFontSize,
      introLineHeight,
      itemFontSize,
      itemLineHeight,
      introLines,
      items,
      boxHeight: Math.max(contentHeight, 164),
    };
  };
  const renderEstimatePreparationChecklist = (docRef, x, y, width, layout = buildEstimatePreparationChecklistLayout(width)) => {
    docRef.setFillColor(...colors.softGray);
    docRef.setDrawColor(...colors.border);
    docRef.rect(x, y, width, layout.boxHeight, 'FD');
    setTextStyle({ size: 10.8, style: 'bold', color: colors.text });
    docRef.text('To Ensure We Provide the Best Possible Service', x + 14, y + 16);
    setTextStyle({ size: layout.introFontSize, style: 'normal', color: colors.muted });
    layout.introLines.forEach((line, index) => {
      docRef.text(line || ' ', x + 14, y + 31 + (index * layout.introLineHeight));
    });
    let itemY = y + 31 + (layout.introLines.length * layout.introLineHeight) + 12;
    layout.items.forEach(lines => {
      docRef.setDrawColor(...colors.muted);
      docRef.setLineWidth(0.8);
      docRef.rect(x + 14, itemY - 6, 7.5, 7.5);
      setTextStyle({ size: layout.itemFontSize, style: 'normal', color: colors.text });
      lines.forEach((line, index) => {
        docRef.text(line || ' ', x + 28, itemY + (index * layout.itemLineHeight));
      });
      itemY += Math.max(14, lines.length * layout.itemLineHeight) + 6;
    });
    return y + layout.boxHeight;
  };
  const buildCommercialEstimateScopeNotesLayout = width => {
    const noteText = safeText(receipt.commercialScopeNoteText) || COMMERCIAL_ESTIMATE_SCOPE_NOTE_TEXT;
    const title = 'Commercial Scope Notes';
    const noteFontSize = 9.1;
    const noteLineHeight = 10.8;
    const noteLines = wrapLines(noteText, width - 28, { size: noteFontSize });
    const contentHeight = 18
      + 16
      + (noteLines.length * noteLineHeight)
      + 18;
    return {
      title,
      noteFontSize,
      noteLineHeight,
      noteLines,
      boxHeight: Math.max(contentHeight, 94),
    };
  };
  const renderCommercialEstimateScopeNotes = (docRef, x, y, width, layout = buildCommercialEstimateScopeNotesLayout(width)) => {
    docRef.setFillColor(...colors.softGray);
    docRef.setDrawColor(...colors.border);
    docRef.rect(x, y, width, layout.boxHeight, 'FD');
    docRef.setFillColor(...colors.blue);
    docRef.rect(x, y, 6, layout.boxHeight, 'F');
    setTextStyle({ size: 10.8, style: 'bold', color: colors.text });
    docRef.text(layout.title, x + 14, y + 18);
    setTextStyle({ size: layout.noteFontSize, style: 'normal', color: colors.text });
    layout.noteLines.forEach((line, index) => {
      docRef.text(line || ' ', x + 14, y + 36 + (index * layout.noteLineHeight));
    });
    return y + layout.boxHeight;
  };
  const buildBalancedTermsLayout = ({ columnWidth, termsTopY, termsBottomY }) => {
    const maxColumnHeight = termsBottomY - termsTopY;
    const fontCandidates = [
      { size: 10.0, lineHeight: 11.4, gap: 5.2 },
      { size: 9.7, lineHeight: 11.0, gap: 5.0 },
      { size: 9.4, lineHeight: 10.7, gap: 4.6 },
      { size: 9.1, lineHeight: 10.4, gap: 4.2 },
      { size: 8.8, lineHeight: 10.0, gap: 4.0 },
      { size: 8.5, lineHeight: 9.6, gap: 3.8 },
    ];
    const buildCandidate = option => {
      const items = ESTIMATE_PDF_TERMS.map(term => {
        const lines = wrapLines(`${term.title}: ${term.text}`, columnWidth - 16, { size: option.size });
        const height = Math.max(option.lineHeight, lines.length * option.lineHeight) + option.gap;
        return { lines, height };
      });
      const totalHeight = items.reduce((sum, item) => sum + item.height, 0);
      let runningLeftHeight = 0;
      let bestSplit = null;
      for (let splitIndex = 1; splitIndex < items.length; splitIndex += 1) {
        runningLeftHeight += items[splitIndex - 1].height;
        const leftHeight = runningLeftHeight;
        const rightHeight = totalHeight - leftHeight;
        if (leftHeight > maxColumnHeight || rightHeight > maxColumnHeight) continue;
        const diff = Math.abs(leftHeight - rightHeight);
        if (!bestSplit || diff < bestSplit.diff) {
          bestSplit = { splitIndex, diff };
        }
      }
      if (!bestSplit) return null;
      return {
        option,
        leftItems: items.slice(0, bestSplit.splitIndex),
        rightItems: items.slice(bestSplit.splitIndex),
      };
    };
    return fontCandidates.map(buildCandidate).find(Boolean)
      || (() => {
        const fallbackOption = fontCandidates[fontCandidates.length - 1];
        const fallbackItems = ESTIMATE_PDF_TERMS.map(term => {
          const lines = wrapLines(`${term.title}: ${term.text}`, columnWidth - 16, { size: fallbackOption.size });
          return {
            lines,
            height: Math.max(fallbackOption.lineHeight, lines.length * fallbackOption.lineHeight) + fallbackOption.gap,
          };
        });
        const midpoint = Math.ceil(fallbackItems.length / 2);
        return {
          option: fallbackOption,
          leftItems: fallbackItems.slice(0, midpoint),
          rightItems: fallbackItems.slice(midpoint),
        };
      })();
  };
  const renderEstimatePageOne = () => {
    let currentY = drawHeader();
    currentY = drawMetaBlock(currentY);

    const tableTopY = currentY;
    const checklistLayout = isCommercialEstimate
      ? buildCommercialEstimateScopeNotesLayout(contentWidth)
      : buildEstimatePreparationChecklistLayout(contentWidth);
    const serviceColWidth = 132;
    const amountColWidth = 96;
    const descriptionColWidth = contentWidth - serviceColWidth - amountColWidth - 24;
    const serviceX = marginX + 10;
    const descriptionX = marginX + serviceColWidth + 18;
    const amountX = pageWidth - marginX - 10;
    const totalsLabelX = descriptionX;
    const totalsAmountRightX = amountX;
    const totalsRowHeight = 20;
    const totalsBaselineOffset = 13;
    const totalsRows = [
      ...(hideSubtotal ? [] : [{ label: 'Subtotal', value: subtotal, bold: false, accent: false, borderWidth: 0.8 }]),
      ...adjustmentLines.map(line => ({ label: line.label, value: line.amount, bold: false, accent: false, borderWidth: 0.8 })),
      ...(showTaxRow ? [{ label: 'Tax', value: taxAmount, bold: false, accent: false, borderWidth: 0.8 }] : []),
      { label: 'Total Estimate', value: totalAmount, bold: true, accent: true, borderWidth: 1.4 },
    ].map(row => {
      const fontSize = row.bold ? 11 : 9.5;
      return {
        ...row,
        fontSize,
        rowHeight: totalsRowHeight,
      };
    });
    const totalsHeight = 22 + (totalsRows.length * totalsRowHeight) + 18;
    const checklistGap = 16;
    const footerReserve = 16;
    const availableTableHeight = Math.max(148, pageHeight - bottomMargin - checklistLayout.boxHeight - checklistGap - totalsHeight - footerReserve - tableTopY - 34);
    const tableLayoutOptions = [
      { serviceSize: 9.6, descriptionSize: 8.9, amountSize: 9.6, lineHeight: 10.8, maxDescriptionLines: 3, maxServiceLines: 2, minRowHeight: 21 },
      { serviceSize: 9.1, descriptionSize: 8.4, amountSize: 9.1, lineHeight: 10.0, maxDescriptionLines: 3, maxServiceLines: 2, minRowHeight: 19 },
      { serviceSize: 8.7, descriptionSize: 8.0, amountSize: 8.7, lineHeight: 9.4, maxDescriptionLines: 2, maxServiceLines: 2, minRowHeight: 18 },
    ];
    const buildTableLayout = option => {
      const rows = tableRows.map(row => {
        const serviceLines = clampLines(
          wrapLines(row.service, serviceColWidth - 12, { size: option.serviceSize, style: 'bold' }),
          option.maxServiceLines
        );
        const descriptionLines = clampLines(
          wrapLines(row.description, descriptionColWidth - 12, { size: option.descriptionSize }),
          option.maxDescriptionLines
        );
        const rowLineCount = Math.max(serviceLines.length || 1, descriptionLines.length || 1, 1);
        return {
          ...row,
          serviceLines,
          descriptionLines,
          rowHeight: Math.max(option.minRowHeight, 7 + (rowLineCount * option.lineHeight)),
        };
      });
      return {
        option,
        rows,
        tableHeight: 38 + rows.reduce((sum, row) => sum + row.rowHeight, 0),
      };
    };
    const selectedTableLayout = tableLayoutOptions
      .map(buildTableLayout)
      .find(layout => layout.tableHeight <= availableTableHeight)
      || buildTableLayout(tableLayoutOptions[tableLayoutOptions.length - 1]);

    setTextStyle({ size: 13, style: 'bold', color: colors.text });
    doc.text('Description of Services', marginX, currentY);
    currentY += 10;
    drawRule(currentY, colors.border, 0.8);
    currentY += 8;
    doc.setFillColor(...colors.light);
    doc.setDrawColor(...colors.border);
    doc.rect(marginX, currentY, contentWidth, 20, 'FD');
    setTextStyle({ size: 9.3, style: 'bold', color: colors.muted });
    doc.text('Service', serviceX, currentY + 13);
    doc.text('Description / Notes', descriptionX, currentY + 13);
    doc.text('Amount', amountX, currentY + 13, { align: 'right' });
    currentY += 20;

    selectedTableLayout.rows.forEach(row => {
      doc.setDrawColor(...colors.border);
      doc.line(marginX, currentY + row.rowHeight, pageWidth - marginX, currentY + row.rowHeight);
      setTextStyle({ size: selectedTableLayout.option.serviceSize, style: 'bold', color: colors.text });
      row.serviceLines.forEach((line, index) => {
        doc.text(line || ' ', serviceX, currentY + 12 + (index * selectedTableLayout.option.lineHeight));
      });
      setTextStyle({ size: selectedTableLayout.option.descriptionSize, style: 'normal', color: colors.text });
      row.descriptionLines.forEach((line, index) => {
        doc.text(line || ' ', descriptionX, currentY + 12 + (index * selectedTableLayout.option.lineHeight));
      });
      setTextStyle({
        size: selectedTableLayout.option.amountSize,
        style: row.amountText === 'Quoted Separately' ? 'italic' : 'normal',
        color: colors.text,
      });
      doc.text(row.amountText || '-', amountX, currentY + 12, { align: 'right' });
      currentY += row.rowHeight;
    });

    currentY += 16;
    const drawTotalsLine = ({ label, value, fontSize, bold = false, accent = false, borderWidth = 0.8, rowHeight }) => {
      setTextStyle({ size: fontSize, style: bold ? 'bold' : 'normal', color: accent ? colors.darkBlue : colors.muted });
      doc.text(label, totalsLabelX, currentY + totalsBaselineOffset);
      setTextStyle({ size: fontSize, style: bold ? 'bold' : 'normal', color: colors.text });
      const amountText = `${value < 0 ? '-' : ''}${money(Math.abs(value))}`;
      doc.text(amountText, totalsAmountRightX, currentY + totalsBaselineOffset, { align: 'right' });
      doc.setDrawColor(...(accent ? colors.blue : colors.border));
      doc.setLineWidth(borderWidth);
      doc.line(totalsLabelX, currentY + rowHeight, totalsAmountRightX, currentY + rowHeight);
      currentY += rowHeight;
    };
    totalsRows.forEach(drawTotalsLine);

    currentY += checklistGap;
    const checklistBottomY = isCommercialEstimate
      ? renderCommercialEstimateScopeNotes(doc, marginX, currentY, contentWidth, checklistLayout)
      : renderEstimatePreparationChecklist(doc, marginX, currentY, contentWidth, checklistLayout);

    const footerText = 'Thank you for choosing FieldOps Demo.';
    const footerLines = wrapLines(footerText, contentWidth - 24, { size: 8.4, style: 'normal' });
    const footerHeight = footerLines.length * 10;
    if (checklistBottomY + footerHeight + 4 <= pageHeight - bottomMargin) {
      setTextStyle({ size: 8.4, style: 'normal', color: colors.muted });
      footerLines.forEach((line, index) => {
        doc.text(line || ' ', pageWidth / 2, checklistBottomY + 12 + (index * 10), { align: 'center' });
      });
    }
  };
  const renderEstimatePageTwoTerms = () => {
    let currentY = topMargin + 6;
    setTextStyle({ size: 16, style: 'bold', color: [17, 24, 39] });
    doc.text('Terms & Conditions', marginX, currentY);
    currentY += 12;
    drawRule(currentY, colors.border, 0.8);
    currentY += 10;

    const acceptanceText = 'Acceptance of Terms: By proceeding with scheduling and allowing FieldOps Demo to commence work, you formally acknowledge that you have read, understood, and agree to the terms and conditions outlined in this estimate.';
    const acceptanceFontSize = 10.5;
    const acceptanceLineHeight = 12.4;
    const acceptanceLines = wrapLines(acceptanceText, contentWidth - 28, { size: acceptanceFontSize });
    const acceptanceHeight = 18 + (acceptanceLines.length * acceptanceLineHeight);
    const acceptanceY = pageHeight - bottomMargin - acceptanceHeight;
    const termsTopY = currentY;
    const termsBottomY = acceptanceY - 16;
    const columnGap = 16;
    const columnWidth = (contentWidth - columnGap) / 2;
    const selectedTermsLayout = buildBalancedTermsLayout({ columnWidth, termsTopY, termsBottomY });
    const renderTermsColumn = (items, x) => {
      let columnY = termsTopY;
      items.forEach(item => {
        doc.setFillColor(...colors.darkBlue);
        doc.circle(x + 4, columnY + 4, 1.4, 'F');
        setTextStyle({ size: selectedTermsLayout.option.size, style: 'normal', color: colors.text });
        item.lines.forEach((line, index) => {
          doc.text(line || ' ', x + 10, columnY + 6 + (index * selectedTermsLayout.option.lineHeight));
        });
        columnY += item.height;
      });
      return columnY;
    };
    renderTermsColumn(selectedTermsLayout.leftItems, marginX);
    renderTermsColumn(selectedTermsLayout.rightItems, marginX + columnWidth + columnGap);

    doc.setFillColor(...colors.softBlue);
    doc.setDrawColor(...colors.border);
    doc.rect(marginX, acceptanceY, contentWidth, acceptanceHeight, 'FD');
    doc.setFillColor(...colors.blue);
    doc.rect(marginX, acceptanceY, 6, acceptanceHeight, 'F');
    setTextStyle({ size: acceptanceFontSize, style: 'normal', color: colors.text });
    acceptanceLines.forEach((line, index) => {
      doc.text(line || ' ', marginX + 16, acceptanceY + 16 + (index * acceptanceLineHeight));
    });
  };

  renderEstimatePageOne();
  doc.addPage();
  renderEstimatePageTwoTerms();
}
function buildRecurringCustomerPacket(customer = {}) {
  const rawAddress = String(customer.address || customer.street || '').trim();
  const explicitCityStateZip = String(customer.cityStateZip || '').trim();
  let street = String(customer.street || '').trim();
  let parsedLine = explicitCityStateZip;

  if (!street) {
    if (rawAddress.includes(',') && !explicitCityStateZip) {
      const [streetPart, ...restParts] = rawAddress.split(',');
      street = streetPart.trim();
      parsedLine = restParts.join(',').trim();
    } else {
      street = rawAddress;
    }
  }

  const parsed = parseCityStateZipParts(parsedLine);
  return {
    id: String(customer.id ?? ''),
    name: String(customer.name || '').trim(),
    phone: String(customer.phone || '').trim(),
    email: String(customer.email || '').trim(),
    street,
    city: String(customer.city || parsed.city || '').trim(),
    state: String(customer.state || parsed.state || '').trim(),
    zip: String(customer.zip || parsed.zip || '').trim(),
  };
}
const RECURRING_MONTH_OPTIONS = [
  { value: 1, label: 'Jan' },
  { value: 2, label: 'Feb' },
  { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' },
  { value: 5, label: 'May' },
  { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' },
  { value: 8, label: 'Aug' },
  { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' },
  { value: 11, label: 'Nov' },
  { value: 12, label: 'Dec' },
];
const RECURRING_SERVICE_PRESETS = [
  'Inside/Outside Storefront',
  'I/O Storefront and Back of Store',
  'Entire Store',
  'Outside Only',
  'Pressure Washing',
];
function normalizeRecurringSelectedMonths(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const months = [];
  source.forEach(item => {
    const monthValue = Number(item);
    if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12 || seen.has(monthValue)) return;
    seen.add(monthValue);
    months.push(monthValue);
  });
  return months.sort((a, b) => a - b);
}
function recurringMonthLabel(value) {
  return RECURRING_MONTH_OPTIONS.find(option => option.value === Number(value))?.label || `M${value}`;
}
function recurringMonthLabelList(value) {
  return normalizeRecurringSelectedMonths(value).map(recurringMonthLabel);
}
function createRecurringSnapshot(customer = {}) {
  return {
    name: String(customer.name || '').trim(),
    phone: String(customer.phone || '').trim(),
    email: String(customer.email || '').trim(),
    street: String(customer.street || '').trim(),
    city: String(customer.city || '').trim(),
    state: String(customer.state || '').trim(),
    zip: String(customer.zip || '').trim(),
  };
}
function createRecurringJobDraft(overrides = {}) {
  const now = new Date();
  const nowMonth = now.getMonth() + 1;
  const nowYear = now.getFullYear();
  const selectedMonths = normalizeRecurringSelectedMonths(overrides.selected_months || overrides.selectedMonths || []);
  const scheduleMode = String(overrides.schedule_mode || overrides.scheduleMode || (selectedMonths.length > 0 ? 'specific' : 'interval')) === 'specific'
    ? 'specific'
    : 'interval';
  return {
    draftId: overrides.draftId || uid(),
    service_label: String(overrides.service_label || '').trim(),
    price: overrides.price ?? 0,
    interval_months: Math.max(1, Number(overrides.interval_months) || 1),
    week_slot: Math.min(5, Math.max(1, Number(overrides.week_slot) || 1)),
    start_month: Math.min(12, Math.max(1, Number(overrides.start_month) || selectedMonths[0] || nowMonth)),
    start_year: Math.max(2000, Number(overrides.start_year) || nowYear),
    status: String(overrides.status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active',
    notes: String(overrides.notes || ''),
    selected_months: selectedMonths,
    schedule_mode: scheduleMode,
  };
}
function buildRecurringJobPayload(draft, snapshot) {
  const scheduleMode = String(draft.schedule_mode || '').toLowerCase() === 'specific' ? 'specific' : 'interval';
  const selectedMonths = scheduleMode === 'specific' ? normalizeRecurringSelectedMonths(draft.selected_months) : [];
  return {
    service_label: String(draft.service_label || '').trim(),
    price: Number(draft.price) || 0,
    interval_months: Math.max(1, Number(draft.interval_months) || 1),
    week_slot: Math.min(5, Math.max(1, Number(draft.week_slot) || 1)),
    start_month: Math.min(12, Math.max(1, Number(draft.start_month) || selectedMonths[0] || (new Date().getMonth() + 1))),
    start_year: Math.max(2000, Number(draft.start_year) || new Date().getFullYear()),
    status: String(draft.status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active',
    notes: String(draft.notes || ''),
    selected_months: selectedMonths,
    snapshot: {
      name: String(snapshot?.name || '').trim(),
      phone: String(snapshot?.phone || '').trim(),
      email: String(snapshot?.email || '').trim(),
      street: String(snapshot?.street || '').trim(),
      city: String(snapshot?.city || '').trim(),
      state: String(snapshot?.state || '').trim(),
      zip: String(snapshot?.zip || '').trim(),
    },
  };
}
function getRecurringScheduleSummary(job = {}) {
  const selectedMonths = normalizeRecurringSelectedMonths(job.selected_months);
  const weekLabel = `week ${Math.min(5, Math.max(1, Number(job.week_slot) || 1))}`;
  if (selectedMonths.length > 0) {
    return `${recurringMonthLabelList(selectedMonths).join(', ')} | ${weekLabel}`;
  }
  const interval = Math.max(1, Number(job.interval_months) || 1);
  const startMonth = recurringMonthLabel(Math.min(12, Math.max(1, Number(job.start_month) || 1)));
  const startYear = Math.max(2000, Number(job.start_year) || new Date().getFullYear());
  return `Every ${interval} month(s) from ${startMonth} ${startYear} | ${weekLabel}`;
}
function loadReceiptLogo() {
  if (!RECEIPT_LOGO_SRC) {
    return Promise.resolve(null);
  }
  if (!_receiptLogoPromise) {
    _receiptLogoPromise = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = RECEIPT_LOGO_SRC;
    });
  }
  return _receiptLogoPromise;
}

function createReceiptTextMeasurer({ fontSize = 9, fontFamily = 'Helvetica' } = {}) {
  if (typeof document === 'undefined') {
    return text => String(text || '').length * (fontSize * 0.52);
  }
  if (!_receiptMeasureCanvas) _receiptMeasureCanvas = document.createElement('canvas');
  const ctx = _receiptMeasureCanvas.getContext('2d');
  ctx.font = `${fontSize}pt ${fontFamily}, Arial, sans-serif`;
  return text => ctx.measureText(String(text || '')).width;
}

function breakReceiptToken(token, maxWidth, measureText) {
  const source = String(token || '');
  if (!source) return [''];
  const parts = [];
  let current = '';
  for (const ch of source) {
    const next = current + ch;
    if (current && measureText(next) > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.length > 0 ? parts : [source];
}

function wrapReceiptTextLines(value, maxWidth, measureText) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [];
  const lines = [];
  normalized.split('\n').forEach(paragraph => {
    if (!paragraph.trim()) {
      lines.push('');
      return;
    }
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let current = '';
    words.forEach(word => {
      const attempt = current ? `${current} ${word}` : word;
      if (!current) {
        if (measureText(word) <= maxWidth) current = word;
        else {
          const parts = breakReceiptToken(word, maxWidth, measureText);
          lines.push(...parts.slice(0, -1));
          current = parts[parts.length - 1] || '';
        }
        return;
      }
      if (measureText(attempt) <= maxWidth) {
        current = attempt;
        return;
      }
      lines.push(current);
      if (measureText(word) <= maxWidth) current = word;
      else {
        const parts = breakReceiptToken(word, maxWidth, measureText);
        lines.push(...parts.slice(0, -1));
        current = parts[parts.length - 1] || '';
      }
    });
    if (current || paragraph === '') lines.push(current);
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function getReceiptBlockHeight(lineCount) {
  const count = Number(lineCount) || 0;
  if (count <= 1) return RECEIPT_LAYOUT.fieldRowHeight;
  return Math.max(RECEIPT_LAYOUT.fieldRowHeight, 4 + count * RECEIPT_LAYOUT.textLineHeight);
}

function buildReceiptServiceRows({ selectedServices = [], otherServiceText = '', measureText }) {
  const selected = new Set(Array.isArray(selectedServices) ? selectedServices : []);
  const standardRows = RECEIPT_STANDARD_SERVICE_LABELS.slice(0, -1).map(label => ({
    key: label,
    checked: selected.has(label),
    lines: [label],
    height: RECEIPT_LAYOUT.fieldRowHeight,
  }));
  const otherLabel = String(otherServiceText || '').trim() ? `Other: ${String(otherServiceText || '').trim()}` : 'Other:';
  const otherLines = wrapReceiptTextLines(otherLabel, RECEIPT_LAYOUT.rightLineEndX - RECEIPT_LAYOUT.rightTextX, measureText);
  standardRows.push({
    key: 'Other:',
    checked: selected.has('Other:'),
    lines: otherLines.length > 0 ? otherLines : ['Other:'],
    height: getReceiptBlockHeight(otherLines.length || 1),
  });
  return standardRows;
}

function calculateReceiptMainLayout({ noteLines = [], locationLines = [], serviceRows = [], showLocationField = false }) {
  const leftBaseY = RECEIPT_LAYOUT.infoStartY + (RECEIPT_LAYOUT.fieldRowHeight * 7);
  const noteHeight = getReceiptBlockHeight(noteLines.length);
  const locationHeight = showLocationField ? getReceiptBlockHeight(locationLines.length) : 0;
  const leftY = leftBaseY + noteHeight + locationHeight;
  const rightY = RECEIPT_LAYOUT.infoStartY + serviceRows.reduce((sum, row) => sum + (row.height || RECEIPT_LAYOUT.fieldRowHeight), 0);
  const summaryY = Math.max(leftY, rightY) + RECEIPT_LAYOUT.summaryGap;
  const remainingBottomMargin = RECEIPT_LAYOUT.footerTopY - summaryY;
  return {
    leftBaseY,
    noteHeight,
    locationHeight,
    leftY,
    rightY,
    summaryY,
    remainingBottomMargin,
    status: remainingBottomMargin < 0 ? 'overflow' : remainingBottomMargin <= RECEIPT_LAYOUT.closeMarginThreshold ? 'warning' : 'fit',
    showLocationField,
  };
}

function measureReceiptLayout({ notes = '', locationList = '', selectedServices = [], otherServiceText = '', continueOnAttachment = false, measureText }) {
  const textMeasure = typeof measureText === 'function' ? measureText : createReceiptTextMeasurer({ fontSize: 9, fontFamily: 'Helvetica' });
  const fullNoteLines = wrapReceiptTextLines(notes, RECEIPT_LAYOUT.leftValueEndX - RECEIPT_LAYOUT.leftValueStartX - 6, textMeasure);
  const fullLocationLines = wrapReceiptTextLines(locationList, RECEIPT_LAYOUT.leftValueEndX - RECEIPT_LAYOUT.leftValueStartX - 6, textMeasure);
  const serviceRows = buildReceiptServiceRows({ selectedServices, otherServiceText, measureText: textMeasure });
  const rawLayout = calculateReceiptMainLayout({
    noteLines: fullNoteLines,
    locationLines: fullLocationLines,
    serviceRows,
    showLocationField: fullLocationLines.length > 0,
  });

  let noteDisplayLines = fullNoteLines;
  let locationDisplayLines = fullLocationLines;
  let noteMovesToAttachment = false;
  let locationMovesToAttachment = false;
  let finalLayout = rawLayout;

  if (continueOnAttachment && rawLayout.status === 'overflow') {
    if (fullLocationLines.length > 0) {
      locationDisplayLines = ['See attachment page for full location list.'];
      locationMovesToAttachment = true;
      finalLayout = calculateReceiptMainLayout({
        noteLines: noteDisplayLines,
        locationLines: locationDisplayLines,
        serviceRows,
        showLocationField: true,
      });
    }
    if (finalLayout.status === 'overflow' && fullNoteLines.length > 0) {
      noteDisplayLines = ['See attachment page for full service notes.'];
      noteMovesToAttachment = true;
      finalLayout = calculateReceiptMainLayout({
        noteLines: noteDisplayLines,
        locationLines: locationDisplayLines,
        serviceRows,
        showLocationField: fullLocationLines.length > 0 || locationMovesToAttachment,
      });
    }
  }

  return {
    ...finalLayout,
    rawStatus: rawLayout.status,
    rawRemainingBottomMargin: rawLayout.remainingBottomMargin,
    noteDisplayLines,
    locationDisplayLines,
    fullNoteLines,
    fullLocationLines,
    noteMovesToAttachment,
    locationMovesToAttachment,
    usesAttachment: continueOnAttachment && (noteMovesToAttachment || locationMovesToAttachment),
    serviceRows,
  };
}

function getSelectedReceiptServices(services = {}) {
  const receiptServices = [];
  if (services.interiorExterior) receiptServices.push('Interior/Exterior Cleaning');
  if (services.exterior) receiptServices.push('Exterior Cleaning');
  if (services.interior) receiptServices.push('Interior Cleaning');
  if (services.pressureWashing) receiptServices.push('Pressure Washing/Soft Washing');
  if (services.screenCleaning) receiptServices.push('Screen Cleaning');
  if (services.hardWater) receiptServices.push('Hard Water Removal');
  if (services.construction) receiptServices.push('Construction/Paint Removal');
  if (services.gutter) receiptServices.push('Gutter Cleaning');
  if (services.other) receiptServices.push('Other:');
  return receiptServices;
}

const generateReceiptPDF = async (receipt) => {
  if (!window.jspdf) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = JSPDF_SRC;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load jsPDF"));
        document.head.appendChild(script);
      });
    } catch (err) {
      alert("Failed to load PDF generator. Please check your internet connection.");
      return;
    }
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const midpointY = pageHeight / 2;
  const safeText = value => value == null ? '' : String(value);
  const documentType = String(receipt.documentType || '').trim().toLowerCase();
  const duplicateCopies = receipt.duplicateCopies !== false;
  const isEstimateDocument = documentType === 'estimate';
  const safeNotes = safeText(receipt.notes);
  const safeLocationList = safeText(receipt.locationList);
  const safeOtherService = safeText(receipt.otherServiceText);
  const safeReceivedBy = safeText(receipt.receivedBy);
  const selectedServices = Array.isArray(receipt.services) ? receipt.services : [];
  const logoImage = await loadReceiptLogo();
  if (isEstimateDocument && !duplicateCopies) {
    renderEstimatePdfDocument({ doc, receipt, logoImage, pageWidth, pageHeight });
    const estimateFileName = `Estimate_${receipt.id}_${(receipt.customerName || 'Customer').replace(/\s+/g, '_')}.pdf`;
    doc.save(estimateFileName);

    try {
      const blobUrl = doc.output('bloburl');
      window.open(blobUrl, '_blank');
    } catch (err) {
      console.warn("Could not open PDF in new tab.", err);
    }
    return;
  }
  const copies = [
    { label: 'CUSTOMER COPY', top: 26 },
    { label: 'MERCHANT COPY', top: midpointY + 14 }
  ];
  const measurePdfText = text => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    return doc.getTextWidth(String(text || ''));
  };
  const receiptLayout = measureReceiptLayout({
    notes: safeNotes,
    locationList: safeLocationList,
    selectedServices,
    otherServiceText: safeOtherService,
    continueOnAttachment: Boolean(receipt.continueOnAttachment),
    measureText: measurePdfText,
  });

  const drawWrappedField = (labelText, lines, currentY) => {
    const safeLines = Array.isArray(lines) ? lines : [];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(labelText, RECEIPT_LAYOUT.leftLabelX, currentY);
    doc.setLineWidth(0.6);
    doc.line(RECEIPT_LAYOUT.leftValueStartX, currentY + 2, RECEIPT_LAYOUT.leftValueEndX, currentY + 2);
    if (safeLines.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      safeLines.forEach((line, index) => {
        doc.text(line || ' ', RECEIPT_LAYOUT.leftValueStartX + 2, currentY - 1 + (index * RECEIPT_LAYOUT.textLineHeight));
      });
    }
    return currentY + getReceiptBlockHeight(safeLines.length);
  };

  const drawDocumentHeader = ({ top, serviceHeadingX = null, serviceHeadingY = null }) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(BUSINESS.name, RECEIPT_LAYOUT.leftLabelX, top + 18);

    if (logoImage) {
      const maxWidth = 82;
      const maxHeight = 50;
      const aspectRatio = logoImage.naturalWidth && logoImage.naturalHeight
        ? logoImage.naturalWidth / logoImage.naturalHeight
        : 1;
      let logoWidth = maxWidth;
      let logoHeight = logoWidth / aspectRatio;
      if (logoHeight > maxHeight) {
        logoHeight = maxHeight;
        logoWidth = logoHeight * aspectRatio;
      }
      doc.addImage(
        logoImage,
        'PNG',
        pageWidth - 30 - logoWidth,
        top + 2,
        logoWidth,
        logoHeight
      );
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Professional, Affordable Window Cleaning', RECEIPT_LAYOUT.leftLabelX, top + 34);
    doc.text(`Phone: ${BUSINESS.phone}`, RECEIPT_LAYOUT.leftLabelX, top + 49);
    doc.text(`Email: ${BUSINESS.email}`, 185, top + 49);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(receipt.documentTitle || 'SERVICE RECEIPT', RECEIPT_LAYOUT.leftLabelX, top + 72);
    if (serviceHeadingX != null && serviceHeadingY != null) {
      doc.text('DESCRIPTION OF SERVICE PROVIDED:', serviceHeadingX, serviceHeadingY);
    }
  };

  const drawLeftDetailBlock = ({ top, numberLabel, dateLabel }) => {
    let leftY = top + RECEIPT_LAYOUT.infoStartY;
    const drawField = (labelText, value, { align = 'left', height = RECEIPT_LAYOUT.fieldRowHeight } = {}) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(labelText, RECEIPT_LAYOUT.leftLabelX, leftY);
      doc.setLineWidth(0.6);
      doc.line(RECEIPT_LAYOUT.leftValueStartX, leftY + 2, RECEIPT_LAYOUT.leftValueEndX, leftY + 2);
      const text = safeText(value);
      if (text) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        if (align === 'right') {
          doc.text(text, RECEIPT_LAYOUT.leftValueEndX - 2, leftY - 1, { align: 'right' });
        } else {
          doc.text(text, RECEIPT_LAYOUT.leftValueStartX + 2, leftY - 1);
        }
      }
      leftY += height;
    };

    drawField(numberLabel, receipt.id, { align: 'right' });
    drawField(dateLabel, receipt.date, { align: 'right' });
    drawField('Customer Name:', receipt.customerName);
    drawField('Service Address:', receipt.address);
    drawField('City, State, ZIP:', receipt.cityStateZip);
    drawField('Phone:', receipt.phone);
    drawField('Email:', receipt.email);

    leftY = drawWrappedField('Service Notes:', receiptLayout.noteDisplayLines, leftY);
    if (receiptLayout.showLocationField) {
      leftY = drawWrappedField('Locations / Units:', receiptLayout.locationDisplayLines, leftY);
    }
    return leftY;
  };

  const drawServiceChecklist = ({ startY, checkboxX, textX, lineEndX }) => {
    let currentY = startY;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    receiptLayout.serviceRows.forEach(row => {
      doc.rect(checkboxX, currentY - 8, 10, 10);
      if (row.checked) {
        doc.setFont('helvetica', 'bold');
        doc.text('x', checkboxX + 2.6, currentY);
        doc.setFont('helvetica', 'normal');
      }
      row.lines.forEach((line, index) => {
        doc.text(line || ' ', textX, currentY + (index * RECEIPT_LAYOUT.textLineHeight));
      });
      if (row.key === 'Other:') {
        doc.line(textX + 30, currentY + 2, lineEndX, currentY + 2);
      }
      currentY += row.height;
    });
    return currentY;
  };

  const drawFooter = ({ footerBottomY, label = '' }) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Thank you for choosing ${BUSINESS.name}.`, RECEIPT_LAYOUT.leftLabelX, footerBottomY - 16);
    doc.text('We truly appreciate your business!', RECEIPT_LAYOUT.leftLabelX, footerBottomY - 2);

    if (label) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`[${label}]`, pageWidth - 40, footerBottomY - 4, { align: 'right' });
    }
  };

  const drawReceiptCopy = ({ label, top }) => {
    const copyBottomY = top + RECEIPT_LAYOUT.copyBottomY;
    drawDocumentHeader({ top, serviceHeadingX: RECEIPT_LAYOUT.rightColumnX, serviceHeadingY: top + 72 });
    drawLeftDetailBlock({ top, numberLabel: 'Receipt #:', dateLabel: 'Date of Service:' });
    drawServiceChecklist({
      startY: top + RECEIPT_LAYOUT.infoStartY,
      checkboxX: RECEIPT_LAYOUT.rightColumnX,
      textX: RECEIPT_LAYOUT.rightTextX,
      lineEndX: RECEIPT_LAYOUT.rightLineEndX,
    });

    const summaryY = top + receiptLayout.summaryY;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Total Cost of Services:', RECEIPT_LAYOUT.leftLabelX, summaryY);
    doc.line(RECEIPT_LAYOUT.leftValueStartX, summaryY + 2, RECEIPT_LAYOUT.leftValueEndX, summaryY + 2);
    doc.setFont('helvetica', 'normal');
    doc.text(`$${Number(receipt.total || 0).toFixed(2)}`, RECEIPT_LAYOUT.leftValueStartX + 2, summaryY - 1);

    const receivedByLabel = 'Received By:';
    doc.setFont('helvetica', 'bold');
    doc.text(receivedByLabel, RECEIPT_LAYOUT.rightColumnX, summaryY);
    const receivedByLineStartX = RECEIPT_LAYOUT.rightColumnX + doc.getTextWidth(receivedByLabel) + 10;
    doc.line(receivedByLineStartX, summaryY + 2, RECEIPT_LAYOUT.rightLineEndX, summaryY + 2);
    if (safeReceivedBy) {
      doc.setFont('helvetica', 'normal');
      doc.text(safeReceivedBy, RECEIPT_LAYOUT.rightLineEndX - 2, summaryY - 1, { align: 'right' });
    }
    drawFooter({ footerBottomY: copyBottomY, label });
  };

  const drawAttachmentPages = () => {
    const sections = [];
    if (receiptLayout.noteMovesToAttachment && safeNotes.trim()) sections.push({ title: 'Service Notes', text: safeNotes });
    if (receiptLayout.locationMovesToAttachment && safeLocationList.trim()) sections.push({ title: 'Locations / Units Serviced', text: safeLocationList });
    if (sections.length === 0) return;

    const attachmentWidth = pageWidth - RECEIPT_LAYOUT.attachmentLeftMargin - RECEIPT_LAYOUT.attachmentRightMargin;
    const measureAttachmentText = text => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      return doc.getTextWidth(String(text || ''));
    };
    let currentY = 0;

    const startAttachmentPage = heading => {
      doc.addPage();
      currentY = RECEIPT_LAYOUT.attachmentTopMargin;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(heading, RECEIPT_LAYOUT.attachmentLeftMargin, currentY);
      currentY += 18;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Receipt #: ${safeText(receipt.id) || 'Receipt'}`, RECEIPT_LAYOUT.attachmentLeftMargin, currentY);
      doc.text(`Customer: ${safeText(receipt.customerName) || 'Customer'}`, RECEIPT_LAYOUT.attachmentLeftMargin + 150, currentY);
      doc.text(`Date: ${safeText(receipt.date) || ''}`, pageWidth - RECEIPT_LAYOUT.attachmentRightMargin, currentY, { align: 'right' });
      currentY += 12;
      doc.line(RECEIPT_LAYOUT.attachmentLeftMargin, currentY, pageWidth - RECEIPT_LAYOUT.attachmentRightMargin, currentY);
      currentY += 18;
    };

    startAttachmentPage(sections.length > 1 ? 'Receipt Attachment' : (receiptLayout.locationMovesToAttachment ? 'Location List Attachment' : 'Service Notes Continued'));

    sections.forEach(section => {
      const lines = wrapReceiptTextLines(section.text, attachmentWidth - 4, measureAttachmentText);
      const contentLines = lines.length > 0 ? lines : [''];
      if (currentY + 18 > pageHeight - RECEIPT_LAYOUT.attachmentBottomMargin) {
        startAttachmentPage(`${section.title} (cont.)`);
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(section.title, RECEIPT_LAYOUT.attachmentLeftMargin, currentY);
      currentY += 18;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      contentLines.forEach(line => {
        if (currentY > pageHeight - RECEIPT_LAYOUT.attachmentBottomMargin) {
          startAttachmentPage(`${section.title} (cont.)`);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text(`${section.title} (cont.)`, RECEIPT_LAYOUT.attachmentLeftMargin, currentY);
          currentY += 18;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
        }
        doc.text(line || ' ', RECEIPT_LAYOUT.attachmentLeftMargin + 4, currentY);
        currentY += RECEIPT_LAYOUT.attachmentLineHeight;
      });
      currentY += 10;
    });
  };

  copies.forEach(drawReceiptCopy);
  doc.setLineWidth(0.8);
  doc.line(24, midpointY, pageWidth - 24, midpointY);
  if (receiptLayout.usesAttachment) drawAttachmentPages();

  const fileName = `Receipt_${receipt.id}_${(receipt.customerName || 'Customer').replace(/\s+/g, '_')}.pdf`;
  doc.save(fileName);

  try {
    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank');
  } catch (err) {
    console.warn("Could not open PDF in new tab.", err);
  }
};

// CSRF token is cached when available and refreshed before mutating requests.
let _csrfToken = null;

// apiFetch â€” throws on HTTP error so callers can catch and show a message.
// Pass { silent: true } as a third arg to swallow errors (used for fire-and-forget syncs).
async function apiFetch(url, options, { silent = false } = {}) {
  try {
    const method = (options?.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      try {
        const t = await fetch('/api/csrf-token');
        if (t.ok) { const d = await t.json(); if (d?.token) _csrfToken = d.token; }
      } catch { /* server unreachable â€” proceed without token */ }
      if (_csrfToken) {
        options = { ...options, headers: { 'X-CSRFToken': _csrfToken, ...(options?.headers || {}) } };
      }
    }
    const res = await fetch(url, options);
    if (!res.ok) {
      let detail = '';
      try {
        const errorJson = await res.json();
        detail = String(errorJson?.error || errorJson?.message || '').trim();
      } catch {
        try { detail = String(await res.text()).trim(); } catch { }
      }
      throw new Error(detail || `Server returned ${res.status} for ${url}`);
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') return null;
    return await res.json();
  } catch (err) {
    if (silent) return null;
    throw err;
  }
}
// Convenience: fire-and-forget â€” logs but never throws
function apiSync(url, options) { apiFetch(url, options, { silent: true }).catch(() => { }); }

function defaultEmployee(team, idx, defaults = {}) {
  return {
    id: uid(), name: defaults.name || `${team[0].toUpperCase() + team.slice(1)} ${idx + 1}`,
    team, active: defaults.active !== undefined ? defaults.active : true,
    includedInLabor: false, getsAdminOverride: defaults.getsAdminOverride || false,
    getsMarketingOverride: defaults.getsMarketingOverride || false,
    laborWeight: 1, adminWeight: 1, marketingWeight: 1,
    ...defaults,
  };
}

function getWeight(val) {
  if (val === "" || val === null || val === undefined) return 1;
  const num = Number(val);
  return (isNaN(num) || num < 0) ? 0 : num;
}

function jobStatusClass(status) {
  if (status === "Estimate") return "badge-warn";
  if (status === "Scheduled") return "badge-scheduled";
  if (status === "In Progress") return "badge-progress";
  if (status === "Completed") return "badge-completed";
  if (status === "Cancelled") return "badge-cancelled";
  return "";
}

function getJobPaymentStatus(job) {
  const raw = String(job?.paymentStatus ?? '').trim().toLowerCase();
  if (raw === 'paid') return "Paid";
  if (raw === 'net-30' || raw === 'net 30' || raw === 'net30') return "Net-30";
  return "Unpaid";
}

function isJobPaid(job) {
  return getJobPaymentStatus(job) === "Paid";
}

function isJobInvoiceSent(job) {
  const value = job?.invoiceSent;
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function jobPaymentStatusClass(status) {
  if (status === "Paid") return "badge-good";
  if (status === "Net-30") return "badge-progress";
  return "badge-warn";
}

function withJobFinancialDefaults(job = {}) {
  return {
    ...job,
    paymentStatus: getJobPaymentStatus(job),
    invoiceSent: isJobInvoiceSent(job),
  };
}

function buildCustomerRouteAddress(customer = {}) {
  return [String(customer.address || '').trim(), String(customer.cityStateZip || '').trim()].filter(Boolean).join(', ');
}

function buildPhoneLinkValue(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '');
}

function formatLedgerTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'â€”';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatLedgerDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'â€”';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ledgerSortValue(value, emptyFallback = Number.POSITIVE_INFINITY) {
  const raw = String(value || '').trim();
  if (!raw) return emptyFallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? emptyFallback : parsed.getTime();
}

function formatLedgerEventTypeLabel(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return 'Communication event';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function contactChannelStyles(channel = '') {
  if (channel === 'phone') return { background: 'rgba(25, 135, 84, 0.12)', color: 'var(--good)', border: '1px solid rgba(25, 135, 84, 0.25)' };
  if (channel === 'sms') return { background: 'rgba(13, 110, 253, 0.12)', color: 'var(--accent)', border: '1px solid rgba(13, 110, 253, 0.22)' };
  if (channel === 'email') return { background: 'rgba(102, 16, 242, 0.12)', color: '#c4a7ff', border: '1px solid rgba(196, 167, 255, 0.22)' };
  if (channel === 'website') return { background: 'rgba(255, 193, 7, 0.12)', color: 'var(--warn)', border: '1px solid rgba(255, 193, 7, 0.22)' };
  if (channel === 'calendar') return { background: 'rgba(32, 201, 151, 0.12)', color: '#68f0c8', border: '1px solid rgba(32, 201, 151, 0.22)' };
  if (channel === 'invoice') return { background: 'rgba(220, 53, 69, 0.12)', color: '#ff9aa5', border: '1px solid rgba(220, 53, 69, 0.22)' };
  return { background: 'var(--panel-soft)', color: 'var(--muted)', border: '1px solid var(--border)' };
}

function logContactEvent(payload = {}) {
  const customerId = String(payload.customerId || '').trim();
  const eventType = String(payload.eventType || '').trim();
  if (!customerId || !eventType) return;
  const body = JSON.stringify({
    customerId,
    jobId: payload.jobId || '',
    estimateId: payload.estimateId || '',
    channel: payload.channel || 'manual',
    direction: payload.direction || 'system',
    eventType,
    subject: payload.subject || '',
    bodySummary: payload.bodySummary || '',
    occurredAt: payload.occurredAt || '',
    userId: payload.userId || '',
  });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/v1/contact-events', blob)) return;
    }
  } catch { }
  fetch('/api/v1/contact-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    keepalive: true,
    body,
  }).catch(() => { });
}

function looksLikeAddressUnit(value = "") {
  return /^(apt|apartment|suite|ste|unit|#|floor|fl|building|bldg|lot|room|rm)\b/i.test(String(value || "").trim());
}

function parseStateZipPart(value = "") {
  const match = String(value || "").trim().match(/^([A-Za-z]{2})(?:\s+([0-9]{5}(?:-[0-9]{4})?))?$/);
  return {
    state: match ? match[1].toUpperCase() : "",
    zip: match?.[2] || "",
    matched: Boolean(match),
  };
}

function composeJobAddressStreetLine(draft = {}) {
  return [String(draft.street || "").trim(), String(draft.unit || "").trim()].filter(Boolean).join(", ");
}

function composeJobAddressRegionLine(draft = {}) {
  const city = String(draft.city || "").trim();
  const state = String(draft.state || "").trim().toUpperCase();
  const zip = String(draft.zip || "").trim();
  const stateZip = [state, zip].filter(Boolean).join(" ");
  if (city && stateZip) return `${city}, ${stateZip}`;
  return city || stateZip;
}

function createJobAddressDraft(address = "") {
  const parts = String(address || "").split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return {
      street: "",
      unit: "",
      city: "",
      state: "",
      zip: "",
    };
  }
  const street = parts.shift() || "";
  let unit = "";
  let city = "";
  let state = "";
  let zip = "";

  if (parts.length === 1) {
    const stateZip = parseStateZipPart(parts[0]);
    if (stateZip.matched) {
      state = stateZip.state;
      zip = stateZip.zip;
    } else {
      const cityStateZipMatch = parts[0].match(/^(.+?)\s+([A-Za-z]{2})(?:\s+([0-9]{5}(?:-[0-9]{4})?))?$/);
      if (cityStateZipMatch) {
        city = cityStateZipMatch[1].trim();
        state = cityStateZipMatch[2].toUpperCase();
        zip = cityStateZipMatch[3] || "";
      } else if (looksLikeAddressUnit(parts[0])) {
        unit = parts[0];
      } else {
        city = parts[0];
      }
    }
  } else if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    const stateZip = parseStateZipPart(lastPart);
    if (stateZip.matched) {
      state = stateZip.state;
      zip = stateZip.zip;
      parts.pop();
      const cityCandidate = parts.pop() || "";
      if (looksLikeAddressUnit(cityCandidate) && parts.length === 0) {
        unit = cityCandidate;
      } else {
        city = cityCandidate;
        unit = parts.join(", ");
      }
    } else {
      const cityStateZipMatch = lastPart.match(/^(.+?)\s+([A-Za-z]{2})(?:\s+([0-9]{5}(?:-[0-9]{4})?))?$/);
      if (cityStateZipMatch) {
        city = cityStateZipMatch[1].trim();
        state = cityStateZipMatch[2].toUpperCase();
        zip = cityStateZipMatch[3] || "";
        parts.pop();
        unit = parts.join(", ");
      } else {
        city = parts.pop() || "";
        unit = parts.join(", ");
      }
    }
  }

  return {
    street,
    unit,
    city,
    state,
    zip,
  };
}

function composeJobAddressDraft(draft = {}) {
  return [composeJobAddressStreetLine(draft), composeJobAddressRegionLine(draft)].filter(Boolean).join(", ");
}

function formatJobDateForReceipt(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const today = new Date();
    return `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`;
  }
  const parts = normalized.split("-");
  return parts.length === 3 ? `${parts[1]}-${parts[2]}-${parts[0]}` : normalized;
}

function buildReceiptNumber(customer = {}) {
  const customerNumber = String(Number(customer?.customerNumber) || 0).padStart(4, "0");
  return `${new Date().getFullYear()}-${customerNumber}-01`;
}

function getJobReceiptAmount(job = {}) {
  return Math.max(0, Number(job?.actualAmount) || Number(job?.quotedAmount) || 0);
}

function getReceiptNotesFromJob(job = {}) {
  const rawNotes = String(job?.notes || "").trim();
  if (!rawNotes) return "";
  const [firstLine = ""] = rawNotes.split(/\r?\n/, 1);
  return /^Estimate\s*#/i.test(firstLine.trim()) ? "" : rawNotes;
}

function extractReceiptOtherServiceText(serviceType = "") {
  const st = String(serviceType || "").trim();
  if (!st) return "";
  const otherPattern = /(\bother\b|track|caulk|ladder|skylight|light fixture|ceiling fan|vent cleaning)/i;
  const parts = st.split(",").map(part => part.trim()).filter(Boolean);
  const matches = parts.filter(part => otherPattern.test(part));
  if (matches.length > 0) return matches.join(", ");
  return otherPattern.test(st) ? st.replace(/^other:?\s*/i, "").trim() : "";
}

function getReceiptServiceSelectionFromJobType(serviceType = "") {
  const st = String(serviceType || "");
  const serviceFlags = {
    interiorExterior: /inside.outside|interior.exterior/i.test(st),
    exterior: /^exterior window|storefront/i.test(st),
    interior: /^interior window/i.test(st),
    pressureWashing: /pressure|soft wash/i.test(st),
    screenCleaning: /screen/i.test(st),
    hardWater: /hard water/i.test(st),
    construction: /construction|paint removal/i.test(st),
    gutter: /gutter/i.test(st),
    other: /(\bother\b|track|caulk|ladder|skylight|light fixture|ceiling fan|vent cleaning)/i.test(st),
  };
  return {
    serviceFlags,
    selectedServices: getSelectedReceiptServices(serviceFlags),
    otherServiceText: extractReceiptOtherServiceText(st),
  };
}

function getReceiptServiceSelectionFromJob(job = {}) {
  const rawNotes = String(job?.notes || "");
  const noteLines = rawNotes.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  if (/^Estimate\s*#/i.test(noteLines[0] || "")) {
    const summaryText = noteLines.slice(1).join("\n");
    const hasWindowScope = /(Double-Hung|Casement|Picture|Storm|Skylight)\s+Windows/i.test(summaryText);
    const fallback = getReceiptServiceSelectionFromJobType(job.serviceType);
    const otherParts = [];
    if (/Caulking \/ Sealing/i.test(summaryText)) otherParts.push("Caulking / Sealing");
    if (/^Tracks\b/im.test(summaryText)) otherParts.push("Track Cleaning");
    if (/Skylights Manual/i.test(summaryText)) otherParts.push("Manual Skylight Cleaning");
    if (/Ladder Access/i.test(summaryText)) otherParts.push("Ladder Access");
    if (/Light Fixtures\/Fans/i.test(summaryText)) otherParts.push("Light Fixture/Ceiling Fan or Vent Cleaning");
    if (fallback.otherServiceText) {
      fallback.otherServiceText.split(",").map(part => part.trim()).filter(Boolean).forEach(part => {
        if (!otherParts.includes(part)) otherParts.push(part);
      });
    }

    const serviceFlags = {
      interiorExterior: hasWindowScope && fallback.serviceFlags.interiorExterior,
      exterior: hasWindowScope && fallback.serviceFlags.exterior,
      interior: hasWindowScope && fallback.serviceFlags.interior,
      pressureWashing: /Pressure Washing/i.test(summaryText),
      screenCleaning: /^Screens\b/im.test(summaryText),
      hardWater: /Hard Water Removal/i.test(summaryText),
      construction: /Construction\/Paint Removal/i.test(summaryText),
      gutter: /Gutter Cleaning/i.test(summaryText),
      other: otherParts.length > 0,
    };

    return {
      serviceFlags,
      selectedServices: getSelectedReceiptServices(serviceFlags),
      otherServiceText: otherParts.join(", "),
    };
  }

  return getReceiptServiceSelectionFromJobType(job.serviceType);
}

function buildJobReceiptPayload(job = {}, customer = {}) {
  const customerCityStateZip = parseCityStateZipParts(customer.cityStateZip || "");
  const addressDraft = createJobAddressDraft(job.address || customer.address || "");
  const city = addressDraft.city || String(customer.city || customerCityStateZip.city || "").trim();
  const state = addressDraft.state || String(customer.state || customerCityStateZip.state || "").trim();
  const zip = addressDraft.zip || String(customer.zip || customerCityStateZip.zip || "").trim();
  const receiptSelection = getReceiptServiceSelectionFromJob(job);

  return {
    id: buildReceiptNumber(customer),
    date: formatJobDateForReceipt(job.scheduledDate),
    customerName: String(customer.name || "").trim(),
    address: composeJobAddressStreetLine(addressDraft) || String(job.address || customer.address || "").trim(),
    cityStateZip: composeJobAddressRegionLine({ city, state, zip }),
    phone: String(customer.phone || "").trim(),
    email: String(customer.email || "").trim(),
    notes: getReceiptNotesFromJob(job),
    locationList: "",
    total: getJobReceiptAmount(job),
    receivedBy: "",
    services: receiptSelection.selectedServices,
    otherServiceText: receiptSelection.otherServiceText,
    continueOnAttachment: false,
  };
}

function getJobDisplayStatusLabel(job, referenceDate = new Date()) {
  const status = String(job?.status || "");
  if (status !== "Completed" || !job?.scheduledDate) return status;
  const jobDate = new Date(job.scheduledDate);
  if (Number.isNaN(jobDate.getTime())) return status;
  let months = (referenceDate.getFullYear() - jobDate.getFullYear()) * 12;
  months += referenceDate.getMonth() - jobDate.getMonth();
  if (months >= 6) return `Inactive (${months} mo)`;
  return status;
}

function isJobInactiveDisplay(job) {
  return getJobDisplayStatusLabel(job).startsWith("Inactive");
}

// â”€â”€â”€ PAYROLL LOGIC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getPayrollJobAmount(job) {
  return Math.max(0, Number(job?.actualAmount) || Number(job?.quotedAmount) || 0);
}

function isProjectedPayrollJob(job) {
  return job?.status !== "Cancelled" && job?.status !== "Estimate";
}

function isCompletedPayrollJob(job) {
  return job?.status === "Completed";
}

function buildPayments({ serviceJobs, employees, ownerAdminOverrideEnabled, ownerMarketingOverrideEnabled }) {
  const payrollJobs = Array.isArray(serviceJobs) ? serviceJobs : [];
  const activeEmployees = employees.filter(e => e.active);
  const activeEmployeeMap = new Map(activeEmployees.map(emp => [String(emp.id), emp]));
  const adminOverrideRecipients = activeEmployees.filter(e => e.getsAdminOverride);
  const marketingOverrideRecipients = activeEmployees.filter(e => e.getsMarketingOverride);

  const laborBaseById = {};
  const adminBaseById = {};
  const marketingBaseById = {};
  const jobBreakdownDrafts = [];

  let gross = 0;
  let spent = 0;
  let laborBase = 0;
  let adminBase = 0;
  let marketingBase = 0;
  let overheadBase = 0;
  let shiftedAdminJobs = 0;
  let shiftedMarketingJobs = 0;
  let unassignedJobs = 0;

  const allocatePool = (members, weightKey, poolAmount, bucket) => {
    const contributions = {};
    const weightTotal = members.reduce((sum, member) => sum + getWeight(member[weightKey]), 0) || (members.length || 0);
    if (!poolAmount || !weightTotal) return { contributions, allocatedAmount: 0 };
    let allocatedAmount = 0;
    members.forEach(member => {
      const share = getWeight(member[weightKey]) / weightTotal;
      if (!share) return;
      const amount = poolAmount * share;
      bucket[member.id] = (bucket[member.id] || 0) + amount;
      contributions[member.id] = amount;
      allocatedAmount += amount;
    });
    return { contributions, allocatedAmount };
  };

  payrollJobs.forEach(job => {
    const jobGross = getPayrollJobAmount(job);
    const jobSpent = Math.max(0, Number(job.overheadSpent) || 0);
    const assignedEmployees = [...new Set(Array.isArray(job.assignedEmployeeIds) ? job.assignedEmployeeIds.map(String) : [])]
      .map(id => activeEmployeeMap.get(id))
      .filter(Boolean);

    const laborMembers = assignedEmployees.filter(emp => emp.team === "labor" || emp.includedInLabor);
    const adminMembers = assignedEmployees.filter(emp => emp.team === "admin");
    const marketingMembers = assignedEmployees.filter(emp => emp.team === "marketing");

    let dynLabor = BASE.labor;
    let dynAdmin = BASE.admin;
    let dynMarketing = BASE.marketing;

    if (adminMembers.length === 0) {
      dynLabor += dynAdmin;
      dynAdmin = 0;
      shiftedAdminJobs += 1;
    }
    if (marketingMembers.length === 0) {
      dynLabor += dynMarketing;
      dynMarketing = 0;
      shiftedMarketingJobs += 1;
    }

    const pools = {
      laborBase: jobGross * dynLabor,
      adminBase: jobGross * dynAdmin,
      marketingBase: jobGross * dynMarketing,
      overheadBase: jobGross * BASE.overhead,
    };
    const laborAllocation = allocatePool(laborMembers, "laborWeight", pools.laborBase, laborBaseById);
    const adminAllocation = allocatePool(adminMembers, "adminWeight", pools.adminBase, adminBaseById);
    const marketingAllocation = allocatePool(marketingMembers, "marketingWeight", pools.marketingBase, marketingBaseById);

    gross += jobGross;
    spent += jobSpent;
    laborBase += pools.laborBase;
    adminBase += pools.adminBase;
    marketingBase += pools.marketingBase;
    overheadBase += pools.overheadBase;

    if (assignedEmployees.length === 0 && (pools.laborBase || pools.adminBase || pools.marketingBase)) {
      unassignedJobs += 1;
    }

    jobBreakdownDrafts.push({
      id: String(job.id ?? uid()),
      jobNumber: job.jobNumber,
      serviceType: job.serviceType || "Service Job",
      status: job.status || "",
      scheduledDate: job.scheduledDate || "",
      address: job.address || "",
      gross: jobGross,
      pools,
      spent: jobSpent,
      dynPercents: { labor: dynLabor, admin: dynAdmin, marketing: dynMarketing },
      flags: {
        shiftedAdmin: adminMembers.length === 0,
        shiftedMarketing: marketingMembers.length === 0,
        noActiveAssignees: assignedEmployees.length === 0,
      },
      employeeContributions: assignedEmployees.map(emp => ({
        id: emp.id,
        name: emp.name,
        team: emp.team,
        includedInLabor: emp.includedInLabor,
        laborBaseRaw: laborAllocation.contributions[emp.id] || 0,
        adminBaseRaw: adminAllocation.contributions[emp.id] || 0,
        marketingBaseRaw: marketingAllocation.contributions[emp.id] || 0,
      })),
    });
  });

  const requestedAdminOverride = ownerAdminOverrideEnabled && adminOverrideRecipients.length > 0 ? gross * BASE.ownerAdminOverride : 0;
  const requestedMarketingOverride = ownerMarketingOverrideEnabled && marketingOverrideRecipients.length > 0 ? gross * BASE.ownerMarketingOverride : 0;
  const adminOverrideAmount = Math.min(requestedAdminOverride, adminBase);
  const marketingOverrideAmount = Math.min(requestedMarketingOverride, marketingBase);
  const adminNetPool = Math.max(0, adminBase - adminOverrideAmount);
  const marketingNetPool = Math.max(0, marketingBase - marketingOverrideAmount);
  const adminScale = adminBase > 0 ? adminNetPool / adminBase : 0;
  const marketingScale = marketingBase > 0 ? marketingNetPool / marketingBase : 0;
  const adminOverridePerRecipient = adminOverrideRecipients.length > 0 ? adminOverrideAmount / adminOverrideRecipients.length : 0;
  const marketingOverridePerRecipient = marketingOverrideRecipients.length > 0 ? marketingOverrideAmount / marketingOverrideRecipients.length : 0;
  const overheadBonusPool = Math.max(0, overheadBase - spent);
  const overheadShortfall = Math.max(0, spent - overheadBase);

  const baseRows = employees.map(emp => {
    const laborBasePay = laborBaseById[emp.id] || 0;
    const adminBasePay = (adminBaseById[emp.id] || 0) * adminScale;
    const marketingBasePay = (marketingBaseById[emp.id] || 0) * marketingScale;
    const basePay = emp.active ? (laborBasePay + adminBasePay + marketingBasePay) : 0;
    const overridePay = emp.active
      ? (emp.getsAdminOverride ? adminOverridePerRecipient : 0) + (emp.getsMarketingOverride ? marketingOverridePerRecipient : 0)
      : 0;

    return {
      ...emp,
      basePay,
      overridePay,
      laborPct: laborBase > 0 ? laborBasePay / laborBase : 0,
      adminPct: adminBase > 0 ? (adminBaseById[emp.id] || 0) / adminBase : 0,
      marketingPct: marketingBase > 0 ? (marketingBaseById[emp.id] || 0) / marketingBase : 0,
    };
  });

  // Distribute overhead bonus by each employee's earned base pay across the selected jobs.
  const totalEarnedBasePay = baseRows.reduce((sum, row) => sum + row.basePay, 0);
  const paymentRows = baseRows.map(row => {
    const bonusPay = row.active && totalEarnedBasePay > 0 ? overheadBonusPool * (row.basePay / totalEarnedBasePay) : 0;
    return { ...row, bonusPay, totalPay: row.basePay + row.overridePay + bonusPay };
  });
  const jobBreakdowns = jobBreakdownDrafts.map(job => {
    const employeeRows = job.employeeContributions.map(employee => {
      const laborBasePay = employee.laborBaseRaw;
      const adminBasePay = employee.adminBaseRaw * adminScale;
      const marketingBasePay = employee.marketingBaseRaw * marketingScale;
      const basePay = laborBasePay + adminBasePay + marketingBasePay;
      const bonusPay = totalEarnedBasePay > 0 ? overheadBonusPool * (basePay / totalEarnedBasePay) : 0;
      if (!basePay && !bonusPay) return null;
      return {
        id: employee.id,
        name: employee.name,
        team: employee.team,
        includedInLabor: employee.includedInLabor,
        laborBasePay,
        adminBasePay,
        marketingBasePay,
        basePay,
        bonusPay,
        totalPay: basePay + bonusPay,
      };
    }).filter(Boolean);
    const adminNetPoolForJob = job.pools.adminBase * adminScale;
    const marketingNetPoolForJob = job.pools.marketingBase * marketingScale;
    const netBasePool = job.pools.laborBase + adminNetPoolForJob + marketingNetPoolForJob;
    const totalBasePayForJob = employeeRows.reduce((sum, row) => sum + row.basePay, 0);
    const totalBonusPayForJob = employeeRows.reduce((sum, row) => sum + row.bonusPay, 0);
    return {
      ...job,
      employeeRows,
      totals: {
        laborBase: job.pools.laborBase,
        adminNetPool: adminNetPoolForJob,
        marketingNetPool: marketingNetPoolForJob,
        overheadBase: job.pools.overheadBase,
        netBasePool,
        basePay: totalBasePayForJob,
        bonusPay: totalBonusPayForJob,
        totalPay: totalBasePayForJob + totalBonusPayForJob,
        unallocatedBase: Math.max(0, netBasePool - totalBasePayForJob),
      },
    };
  });
  const totalUnallocatedBase = jobBreakdowns.reduce((sum, job) => sum + job.totals.unallocatedBase, 0);

  return {
    paymentRows,
    jobBreakdowns,
    totals: {
      gross,
      spent,
      laborBase,
      adminBase,
      marketingBase,
      overheadBase,
      adminOverrideAmount,
      marketingOverrideAmount,
      adminNetPool,
      marketingNetPool,
      overheadBonusPool,
      overheadShortfall,
      jobCount: payrollJobs.length,
      totalPayroll: paymentRows.reduce((sum, row) => sum + row.totalPay, 0),
      unallocatedBase: totalUnallocatedBase,
    },
    dynPercents: {
      labor: gross > 0 ? laborBase / gross : 0,
      admin: gross > 0 ? adminBase / gross : 0,
      marketing: gross > 0 ? marketingBase / gross : 0,
    },
    flags: {
      shiftedAdminJobs,
      shiftedMarketingJobs,
      unassignedJobs,
    }
  };
}

// â”€â”€â”€ CUSTOMER MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CustomerModal({ customer, onSave, onClose }) {
  const [form, setForm] = useState(customer
    ? {
      name: customer.name || "",
      address: customer.address || "",
      cityStateZip: customer.cityStateZip || "",
      phone: customer.phone || "",
      email: customer.email || "",
      status: customer.status || "Lead",
      notes: customer.notes || "",
      customerNumber: customer.customerNumber ?? "",
      markerEmoji: customer.markerEmoji || "",
    }
    : {
      name: "",
      address: "",
      cityStateZip: "",
      phone: "",
      email: "",
      status: "Lead",
      notes: "",
      customerNumber: "",
      markerEmoji: "",
    }
  );
  const [errors, setErrors] = useState({});
  const firstInputRef = useRef(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);
  useEffect(() => { const h = e => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  const set = (f, v) => { setForm(p => ({ ...p, [f]: v })); if (errors[f]) setErrors(p => ({ ...p, [f]: null })); };
  const handleSave = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    if (form.phone && !/^[0-9\s\-()+.]*([ ]?(ext|x)[ ]?[0-9]*)?$/i.test(form.phone)) errs.phone = "Enter a valid phone number.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = "Enter a valid email address.";
    if (Object.keys(errs).length) return setErrors(errs);
    onSave({
      ...form,
      address: String(form.address || "").trim(),
      cityStateZip: String(form.cityStateZip || "").trim(),
      phone: String(form.phone || "").trim(),
      email: String(form.email || "").trim(),
      markerEmoji: normalizeMarkerEmoji(form.markerEmoji),
    });
  };
  const markerQuickPickValue = CUSTOMER_MARKER_EMOJI_OPTIONS.some(option => option.value === form.markerEmoji) ? form.markerEmoji : "__custom__";

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header"><h3>{customer ? "Edit Customer" : "New Customer"}</h3><button className="modal-close" onClick={onClose}>&times;</button></div>
        <div className="modal-field">
          <label>Customer # <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 400 }}>{customer ? "(editable â€” updates receipt numbers)" : "(leave blank to auto-assign)"}</span></label>
          <input type="number" min="1" value={form.customerNumber} onChange={e => set("customerNumber", e.target.value ? Number(e.target.value) : "")} placeholder="Auto-assigned" style={{ fontWeight: 700, color: 'var(--accent)', maxWidth: 160 }} />
        </div>
        <div className="modal-field"><label>Name / Company <span style={{ color: 'var(--danger)' }}>*</span></label><input ref={firstInputRef} value={form.name} onChange={e => set("name", e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSave(); }} style={errors.name ? { borderColor: 'var(--danger)' } : {}} />{errors.name && <div className="field-error">{errors.name}</div>}</div>
        <div className="modal-field"><label>Address</label><input value={form.address} onChange={e => set("address", e.target.value)} placeholder="e.g. 100 Demo Way" /></div>
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="modal-field"><label>City, State, ZIP</label><input value={form.cityStateZip} onChange={e => set("cityStateZip", e.target.value)} placeholder="Racine, WI 53406" /></div>
          <div className="modal-field"><label>Status</label><select value={form.status} onChange={e => set("status", e.target.value)}><option value="Lead">Lead</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="modal-field"><label>Phone</label><input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(555) 010-0000" style={errors.phone ? { borderColor: 'var(--danger)' } : {}} />{errors.phone && <div className="field-error">{errors.phone}</div>}</div>
          <div className="modal-field"><label>Email</label><input value={form.email} onChange={e => set("email", e.target.value)} placeholder="demo-billing@example.invalid" style={errors.email ? { borderColor: 'var(--danger)' } : {}} />{errors.email && <div className="field-error">{errors.email}</div>}</div>
        </div>
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="modal-field">
            <label>Map Marker Quick Pick</label>
            <select value={markerQuickPickValue} onChange={e => { if (e.target.value !== "__custom__") set("markerEmoji", e.target.value); }}>
              {CUSTOMER_MARKER_EMOJI_OPTIONS.map(option => <option key={option.label} value={option.value}>{option.label}</option>)}
              <option value="__custom__">Custom Emoji Typed Below</option>
            </select>
          </div>
          <div className="modal-field">
            <label>Custom Emoji <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 400 }}>(Windows: Win + .)</span></label>
            <input value={form.markerEmoji} onChange={e => set("markerEmoji", normalizeMarkerEmoji(e.target.value))} placeholder="Optional custom marker" maxLength="8" />
          </div>
        </div>
        <div className="note" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', color: '#0d1224', border: '2px solid var(--accent)', fontSize: 17, lineHeight: 1 }}>{form.markerEmoji || 'ðŸ“'}</div>
          <div className="small" style={{ margin: 0, color: 'var(--muted)' }}>{form.markerEmoji ? 'This emoji will be used for the customer marker on the map.' : 'Leave blank to keep the default map pin.'}</div>
        </div>
        <div className="modal-field" style={{ marginTop: 16 }}><label>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={3} style={{ resize: 'vertical' }} /></div>
        <div className="modal-actions"><button className="btn btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-accent btn-sm" onClick={handleSave}>{customer ? "Save Changes" : "Add Customer"}</button></div>
      </div>
    </div>
  );
}

// â”€â”€â”€ CUSTOMER COMMUNICATIONS MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CustomerCommunicationsModal({ customer, onClose, onUpdated = null }) {
  const [events, setEvents] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [preferences, setPreferences] = useState({
    customerId: customer?.id || '',
    phoneAllowed: true,
    smsAllowed: true,
    emailAllowed: true,
    doNotContact: false,
    preferredChannel: '',
    preferredTimeWindow: '',
    notes: '',
  });
  const [noteForm, setNoteForm] = useState({ subject: '', bodySummary: '' });
  const [followupForm, setFollowupForm] = useState({ channel: 'phone', dueAt: toLocalISODate(), subject: '', bodySummary: '' });
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingFollowup, setSavingFollowup] = useState(false);
  const [requestError, setRequestError] = useState('');

  const loadData = useCallback(async () => {
    if (!customer?.id) return;
    setLoading(true);
    setRequestError('');
    try {
      const [eventRows, followupRows, preferenceRow] = await Promise.all([
        apiFetch(`/api/v1/customers/${customer.id}/contact-events?limit=25`),
        apiFetch(`/api/v1/customers/${customer.id}/followups?status=open`),
        apiFetch(`/api/v1/customers/${customer.id}/contact-preferences`),
      ]);
      setEvents(Array.isArray(eventRows) ? eventRows : []);
      setFollowups(Array.isArray(followupRows) ? followupRows : []);
      setPreferences(preferenceRow || {
        customerId: customer.id,
        phoneAllowed: true,
        smsAllowed: true,
        emailAllowed: true,
        doNotContact: false,
        preferredChannel: '',
        preferredTimeWindow: '',
        notes: '',
      });
    } catch (err) {
      setRequestError(err?.message || 'Failed to load communications ledger.');
    } finally {
      setLoading(false);
    }
  }, [customer?.id]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const handler = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const savePreferences = async () => {
    setSavingPrefs(true);
    setRequestError('');
    try {
      const saved = await apiFetch(`/api/v1/customers/${customer.id}/contact-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      setPreferences(saved || preferences);
      await loadData();
      if (onUpdated) onUpdated();
    } catch (err) {
      setRequestError(err?.message || 'Failed to save contact preferences.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const addManualNote = async () => {
    if (!noteForm.subject.trim() && !noteForm.bodySummary.trim()) {
      setRequestError('Enter a subject or note before saving.');
      return;
    }
    setSavingNote(true);
    setRequestError('');
    try {
      const created = await apiFetch('/api/v1/contact-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id,
          channel: 'manual',
          direction: 'system',
          eventType: 'note',
          subject: noteForm.subject.trim() || `Manual note for ${customer.name}`,
          bodySummary: noteForm.bodySummary.trim(),
        }),
      });
      setEvents(prev => [created, ...prev].filter(Boolean).slice(0, 25));
      setNoteForm({ subject: '', bodySummary: '' });
      if (onUpdated) onUpdated();
    } catch (err) {
      setRequestError(err?.message || 'Failed to save note.');
    } finally {
      setSavingNote(false);
    }
  };

  const addFollowup = async () => {
    if (!followupForm.dueAt) {
      setRequestError('Choose a due date for the follow-up.');
      return;
    }
    if (!followupForm.subject.trim()) {
      setRequestError('Enter a follow-up subject.');
      return;
    }
    setSavingFollowup(true);
    setRequestError('');
    try {
      await apiFetch(`/api/v1/customers/${customer.id}/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(followupForm),
      });
      setFollowupForm({ channel: 'phone', dueAt: toLocalISODate(), subject: '', bodySummary: '' });
      await loadData();
      if (onUpdated) onUpdated();
    } catch (err) {
      setRequestError(err?.message || 'Failed to create follow-up.');
    } finally {
      setSavingFollowup(false);
    }
  };

  const completeFollowup = async followup => {
    setRequestError('');
    try {
      await apiFetch(`/api/v1/customer-followups/${followup.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      await loadData();
      if (onUpdated) onUpdated();
    } catch (err) {
      setRequestError(err?.message || 'Failed to complete follow-up.');
    }
  };

  return (
    <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 960 }}>
        <div className="modal-header">
          <div>
            <h3 style={{ marginBottom: 4 }}>Communications Ledger</h3>
            <div className="small" style={{ color: 'var(--muted)' }}>{customer?.name || 'Customer'} | {customer?.phone || 'No phone'}{customer?.email ? ` | ${customer.email}` : ''}</div>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {requestError && <div className="alert" style={{ marginBottom: 16 }}>{requestError}</div>}

        <div className="grid" style={{ marginTop: 0 }}>
          <div className="card span-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>Contact Preferences</h4>
              <button className="btn btn-sm btn-accent" onClick={savePreferences} disabled={savingPrefs}>{savingPrefs ? 'Saving...' : 'Save'}</button>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={preferences.phoneAllowed} onChange={event => setPreferences(prev => ({ ...prev, phoneAllowed: event.target.checked }))} /> Phone allowed</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={preferences.smsAllowed} onChange={event => setPreferences(prev => ({ ...prev, smsAllowed: event.target.checked }))} /> SMS allowed</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={preferences.emailAllowed} onChange={event => setPreferences(prev => ({ ...prev, emailAllowed: event.target.checked }))} /> Email allowed</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={preferences.doNotContact} onChange={event => setPreferences(prev => ({ ...prev, doNotContact: event.target.checked }))} /> Do not contact</label>
              <div className="modal-field" style={{ marginBottom: 0 }}>
                <label>Preferred Channel</label>
                <select value={preferences.preferredChannel || ''} onChange={event => setPreferences(prev => ({ ...prev, preferredChannel: event.target.value }))}>
                  <option value="">None</option>
                  <option value="phone">Phone</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div className="modal-field" style={{ marginBottom: 0 }}>
                <label>Preferred Time Window</label>
                <input value={preferences.preferredTimeWindow || ''} onChange={event => setPreferences(prev => ({ ...prev, preferredTimeWindow: event.target.value }))} placeholder="Weekdays after 3 PM" />
              </div>
              <div className="modal-field" style={{ marginBottom: 0 }}>
                <label>Preference Notes</label>
                <textarea rows={3} value={preferences.notes || ''} onChange={event => setPreferences(prev => ({ ...prev, notes: event.target.value }))} style={{ resize: 'vertical' }} />
              </div>
            </div>
          </div>

          <div className="card span-4">
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Manual Note</h4>
            <div className="modal-field" style={{ marginBottom: 10 }}>
              <label>Subject</label>
              <input value={noteForm.subject} onChange={event => setNoteForm(prev => ({ ...prev, subject: event.target.value }))} placeholder="Left voicemail after estimate" />
            </div>
            <div className="modal-field" style={{ marginBottom: 12 }}>
              <label>Summary</label>
              <textarea rows={5} value={noteForm.bodySummary} onChange={event => setNoteForm(prev => ({ ...prev, bodySummary: event.target.value }))} style={{ resize: 'vertical' }} placeholder="What happened, what was promised, and what needs follow-up." />
            </div>
            <button className="btn btn-sm btn-accent" onClick={addManualNote} disabled={savingNote}>{savingNote ? 'Saving...' : 'Add Note'}</button>
          </div>

          <div className="card span-4">
            <h4 style={{ marginTop: 0, marginBottom: 12 }}>Schedule Follow-up</h4>
            <div className="modal-field" style={{ marginBottom: 10 }}>
              <label>Subject</label>
              <input value={followupForm.subject} onChange={event => setFollowupForm(prev => ({ ...prev, subject: event.target.value }))} placeholder="Call back about revised quote" />
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="modal-field">
                <label>Channel</label>
                <select value={followupForm.channel} onChange={event => setFollowupForm(prev => ({ ...prev, channel: event.target.value }))}>
                  <option value="phone">Phone</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div className="modal-field">
                <label>Due Date</label>
                <input type="date" value={followupForm.dueAt} onChange={event => setFollowupForm(prev => ({ ...prev, dueAt: event.target.value }))} />
              </div>
            </div>
            <div className="modal-field" style={{ marginBottom: 12 }}>
              <label>Summary</label>
              <textarea rows={3} value={followupForm.bodySummary} onChange={event => setFollowupForm(prev => ({ ...prev, bodySummary: event.target.value }))} style={{ resize: 'vertical' }} placeholder="What needs to happen on the follow-up." />
            </div>
            <button className="btn btn-sm btn-accent" onClick={addFollowup} disabled={savingFollowup}>{savingFollowup ? 'Saving...' : 'Create Follow-up'}</button>
          </div>
        </div>

        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card span-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h4 style={{ margin: 0 }}>Open Follow-ups</h4>
              <span className="badge">{followups.length}</span>
            </div>
            {loading ? (
              <div className="small" style={{ color: 'var(--muted)' }}>Loading follow-ups...</div>
            ) : followups.length === 0 ? (
              <div className="small" style={{ color: 'var(--muted)' }}>No open follow-ups for this customer.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {followups.map(followup => (
                  <div key={followup.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{followup.subject || 'Follow-up'}</div>
                        <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>Due {followup.dueAt || 'unscheduled'} | {followup.channel}</div>
                        {followup.bodySummary && <div className="small" style={{ marginTop: 8 }}>{followup.bodySummary}</div>}
                      </div>
                      <button className="btn btn-sm" onClick={() => completeFollowup(followup)}>Complete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card span-8">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h4 style={{ margin: 0 }}>Recent Events</h4>
              <span className="badge">{events.length}</span>
            </div>
            {loading ? (
              <div className="small" style={{ color: 'var(--muted)' }}>Loading events...</div>
            ) : events.length === 0 ? (
              <div className="small" style={{ color: 'var(--muted)' }}>No communication history recorded yet.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                {events.map(event => (
                  <div key={event.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className="badge" style={contactChannelStyles(event.channel)}>{event.channel || 'manual'}</span>
                          <span className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{event.direction || 'system'}</span>
                          {event.jobNumber ? <span className="small" style={{ color: 'var(--muted)' }}>Job #{event.jobNumber}</span> : null}
                        </div>
                        <div style={{ fontWeight: 700, marginTop: 8 }}>{event.subject || event.eventType || 'Communication event'}</div>
                        {event.bodySummary && <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{event.bodySummary}</div>}
                      </div>
                      <div className="small" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatLedgerTimestamp(event.occurredAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const SERVICE_TYPES = ["Interior Window Cleaning", "Exterior Window Cleaning", "Inside/Outside Window Cleaning", "Screen Cleaning", "Track Cleaning", "Pressure Washing", "Gutter Cleaning", "Storefront Route Service", "Other"];
const SERVICE_CATEGORY_OPTIONS = [
  { value: "", label: "None / Standalone" },
  { value: "Inside/Outside", label: "Inside/Outside" },
  { value: "Exterior Only", label: "Exterior Only" },
  { value: "Power Washing", label: "Power Washing" },
];
const JOB_FREQUENCY_OPTIONS = [
  { value: "", label: "Standalone" },
  { value: "default", label: "Use Category Default" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
];
const DEFAULT_FREQUENCY_BY_CATEGORY = {
  "Inside/Outside": "quarterly",
  "Exterior Only": "monthly",
  "Power Washing": "annual",
};
const JOB_FREQUENCY_LABELS = {
  "": "Standalone",
  standalone: "Standalone",
  default: "Category Default",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

function inferServiceCategory(serviceType = "") {
  const normalized = String(serviceType || "").toLowerCase();
  if (normalized.includes("inside/outside") || normalized.includes("inside outside")) return "Inside/Outside";
  if (normalized.includes("pressure") || normalized.includes("power wash") || normalized.includes("soft wash")) return "Power Washing";
  if (normalized.includes("exterior")) return "Exterior Only";
  return "";
}

function resolveJobFrequencyKey(serviceCategory = "", frequency = "") {
  const normalizedFrequency = String(frequency || "").trim().toLowerCase();
  if (normalizedFrequency === "standalone") return "";
  if (["monthly", "quarterly", "annual"].includes(normalizedFrequency)) return normalizedFrequency;
  if ((normalizedFrequency === "" || normalizedFrequency === "default") && serviceCategory) {
    return DEFAULT_FREQUENCY_BY_CATEGORY[serviceCategory] || "";
  }
  return "";
}

function getJobRecurrenceSummary(job) {
  const resolvedFrequency = resolveJobFrequencyKey(job?.serviceCategory, job?.frequency);
  const parts = [];
  if (job?.serviceCategory) parts.push(job.serviceCategory);
  if (resolvedFrequency) parts.push(JOB_FREQUENCY_LABELS[resolvedFrequency]);
  return parts.join(" Â· ");
}

function createInitialJobForm(job) {
  if (job) {
    return {
      customerId: job.customerId || "",
      address: job.address || "",
      serviceType: job.serviceType || "Interior Window Cleaning",
      serviceCategory: job.serviceCategory || "",
      frequency: job.frequency || "",
      quotedAmount: job.quotedAmount || "",
      actualAmount: job.actualAmount || "",
      overheadSpent: job.overheadSpent || "",
      status: job.status || "Scheduled",
      paymentStatus: getJobPaymentStatus(job),
      invoiceSent: isJobInvoiceSent(job),
      scheduledDate: job.scheduledDate || "",
      assignedEmployeeIds: job.assignedEmployeeIds || [],
      notes: job.notes || ""
    };
  }

  const serviceType = "Interior Window Cleaning";
  const serviceCategory = inferServiceCategory(serviceType);
  return {
    customerId: "",
    address: "",
    serviceType,
    serviceCategory,
    frequency: serviceCategory ? "default" : "",
    quotedAmount: "",
    actualAmount: "",
    overheadSpent: "",
    status: "Scheduled",
    paymentStatus: "Unpaid",
    invoiceSent: false,
    scheduledDate: "",
    assignedEmployeeIds: [],
    notes: ""
  };
}

// â”€â”€â”€ JOB MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function JobModal({ job, customers, employees, onSave, onClose }) {
  const [form, setForm] = useState(createInitialJobForm(job));
  const [errors, setErrors] = useState({});
  const activeAssignableEmployees = employees.filter(e => e.active);

  useEffect(() => { const h = e => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);

  const set = (f, v) => {
    setForm(p => {
      const next = { ...p, [f]: v };
      if (f === "customerId" && v) { const c = customers.find(c => String(c.id) === String(v)); if (c?.address && !p.address) next.address = c.address; }
      if (f === "serviceType") {
        const previousSuggestedCategory = inferServiceCategory(p.serviceType);
        const nextSuggestedCategory = inferServiceCategory(v);
        if (!p.serviceCategory || p.serviceCategory === previousSuggestedCategory) next.serviceCategory = nextSuggestedCategory;
        if (!p.frequency || p.frequency === "default") next.frequency = next.serviceCategory ? "default" : "";
      }
      if (f === "serviceCategory" && (!p.frequency || p.frequency === "default")) {
        next.frequency = v ? "default" : "";
      }
      return next;
    });
    if (errors[f]) setErrors(p => ({ ...p, [f]: null }));
    if (f === "status" && v !== "Completed" && errors.assignedEmployeeIds) setErrors(p => ({ ...p, assignedEmployeeIds: null }));
  };
  const toggleEmployee = id => {
    setForm(p => ({ ...p, assignedEmployeeIds: p.assignedEmployeeIds.includes(id) ? p.assignedEmployeeIds.filter(i => i !== id) : [...p.assignedEmployeeIds, id] }));
    if (errors.assignedEmployeeIds) setErrors(p => ({ ...p, assignedEmployeeIds: null }));
  };
  const handleSave = () => {
    const assignedActiveEmployeeCount = form.assignedEmployeeIds.filter(id => activeAssignableEmployees.some(emp => String(emp.id) === String(id))).length;
    const nextErrors = {};
    if (!form.scheduledDate) nextErrors.scheduledDate = "Required";
    if (form.status === "Completed" && assignedActiveEmployeeCount === 0) nextErrors.assignedEmployeeIds = "Assign at least one active employee before marking this job completed.";
    if (Object.keys(nextErrors).length) return setErrors(nextErrors);
    onSave({ ...form, quotedAmount: Number(form.quotedAmount) || 0, actualAmount: Number(form.actualAmount) || 0, overheadSpent: Number(form.overheadSpent) || 0 });
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true">
        <div className="modal-header"><h3>{job ? "Edit Job" : "New Job"}</h3><button className="modal-close" onClick={onClose}>&times;</button></div>
        <div className="row3" style={{ marginBottom: 0 }}>
          <div className="modal-field"><label>Customer</label><select value={form.customerId} onChange={e => set("customerId", e.target.value)}><option value="">â€” Unassigned â€”</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="modal-field"><label>Service Type</label><select value={form.serviceType} onChange={e => set("serviceType", e.target.value)}>{SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="modal-field"><label>Service Category</label><select value={form.serviceCategory} onChange={e => set("serviceCategory", e.target.value)}>{SERVICE_CATEGORY_OPTIONS.map(option => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}</select></div>
        </div>
        <div className="modal-field"><label>Job Address{customers.find(c => String(c.id) === String(form.customerId)) && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (auto-filled from customer)</span>}</label><input value={form.address} onChange={e => set("address", e.target.value)} placeholder="e.g. 100 Demo Way" /></div>
        <div className="row3" style={{ marginBottom: 0 }}>
          <div className="modal-field"><label>Quoted Amount</label><input type="number" min="0" step="0.01" value={form.quotedAmount} onChange={e => set("quotedAmount", e.target.value)} placeholder="0.00" /></div>
          <div className="modal-field"><label>Actual Amount (Gross)</label><input type="number" min="0" step="0.01" value={form.actualAmount} onChange={e => set("actualAmount", e.target.value)} placeholder="0.00" /></div>
          <div className="modal-field"><label>Overhead Spent</label><input type="number" min="0" step="0.01" value={form.overheadSpent} onChange={e => set("overheadSpent", e.target.value)} placeholder="0.00" /></div>
        </div>
        <div className="row4" style={{ marginBottom: 0 }}>
          <div className="modal-field"><label>Status</label><select value={form.status} onChange={e => set("status", e.target.value)}>{["Estimate", "Scheduled", "In Progress", "Completed", "Cancelled"].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="modal-field">
            <label>Financial Status</label>
            <select value={form.paymentStatus} onChange={e => set("paymentStatus", e.target.value)} style={{ border: form.paymentStatus === "Unpaid" ? '1px solid var(--warn)' : '1px solid var(--good)' }}>
              <option value="Unpaid">Unpaid Balance</option>
              <option value="Paid">Paid in Full</option>
              <option value="Net-30">Net-30 (Pending)</option>
            </select>
          </div>
          <div className="modal-field"><label>Frequency <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{form.serviceCategory && form.frequency === "default" ? `(defaults to ${JOB_FREQUENCY_LABELS[DEFAULT_FREQUENCY_BY_CATEGORY[form.serviceCategory]]})` : ""}</span></label><select value={form.frequency} onChange={e => set("frequency", e.target.value)}>{JOB_FREQUENCY_OPTIONS.map(option => <option key={option.value || "standalone"} value={option.value}>{option.label}</option>)}</select></div>
          <div className="modal-field"><label>Scheduled Date <span style={{ color: 'var(--danger)' }}>*</span></label><input type="date" value={form.scheduledDate} onChange={e => set("scheduledDate", e.target.value)} style={errors.scheduledDate ? { borderColor: 'var(--danger)' } : {}} />{errors.scheduledDate && <div className="field-error">{errors.scheduledDate}</div>}</div>
        </div>
        <div className="modal-field" style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: 0 }}>
            <input type="checkbox" checked={form.invoiceSent} onChange={e => set("invoiceSent", e.target.checked)} style={{ width: '18px', height: '18px' }} />
            <span style={{ fontWeight: form.invoiceSent ? 600 : 400, color: form.invoiceSent ? 'var(--good)' : 'var(--text)' }}>Invoice Sent to Client</span>
          </label>
        </div>
        <div className="modal-field">
          <label>Assigned Employees <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{form.status === "Completed" ? "(required when completed)" : "(optional until completed)"}</span></label>
          {activeAssignableEmployees.length > 0 ? (
            <div className="checkbox-group" style={{ padding: '10px 12px', background: 'var(--panel-soft)', borderRadius: '12px', border: `1px solid ${errors.assignedEmployeeIds ? 'var(--danger)' : 'var(--border)'}` }}>
              {activeAssignableEmployees.map(emp => <label key={emp.id}><input type="checkbox" checked={form.assignedEmployeeIds.includes(emp.id)} onChange={() => toggleEmployee(emp.id)} /> {emp.name} <span style={{ color: 'var(--muted)', fontSize: 11 }}>({emp.team})</span></label>)}
            </div>
          ) : (
            <div className="note" style={{ marginTop: 0, borderColor: errors.assignedEmployeeIds ? 'var(--danger)' : 'var(--border)' }}>No active employees are available to assign.</div>
          )}
          {errors.assignedEmployeeIds && <div className="field-error">{errors.assignedEmployeeIds}</div>}
        </div>
        <div className="modal-field"><label>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} style={{ resize: 'vertical' }} placeholder="Gate codes, special instructions..." /></div>
        <div className="modal-actions"><button className="btn btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-accent btn-sm" onClick={handleSave}>{job ? "Save Changes" : "Add Job"}</button></div>
      </div>
    </div>
  );
}

// PayrollTab is kept only as a compatibility alias.
// The old inline implementation drifted and referenced undefined handlers.
function PayrollTab(props) {
  return <PayrollTabEnhanced {...props} />;
}

// â”€â”€â”€ PAYROLL TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PayrollTabEnhanced({ serviceJobs, setServiceJobs, employees, setEmployees }) {
  const fileInputRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [ownerAdminOverrideEnabled, setOwnerAdminOverrideEnabled] = useState(true);
  const [ownerMarketingOverrideEnabled, setOwnerMarketingOverrideEnabled] = useState(true);
  const [payrollMode, setPayrollMode] = useState("completed");
  const [requestError, setRequestError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [drilldownEmployeeId, setDrilldownEmployeeId] = useState(null);

  const payrollJobs = useMemo(() => {
    let jobs = serviceJobs.filter(payrollMode === "active" ? isProjectedPayrollJob : isCompletedPayrollJob);
    if (startDate) jobs = jobs.filter(j => j.scheduledDate && j.scheduledDate >= startDate);
    if (endDate) jobs = jobs.filter(j => j.scheduledDate && j.scheduledDate <= endDate);
    return jobs;
  }, [serviceJobs, payrollMode, startDate, endDate]);
  const result = useMemo(
    () => buildPayments({ serviceJobs: payrollJobs, employees, ownerAdminOverrideEnabled, ownerMarketingOverrideEnabled }),
    [payrollJobs, employees, ownerAdminOverrideEnabled, ownerMarketingOverrideEnabled]
  );

  const modeMeta = payrollMode === "active"
    ? {
      title: "All Active Jobs",
      description: "Projection mode includes Scheduled, In Progress, and Completed jobs. Estimate and Cancelled jobs stay out.",
      empty: <>No active payroll jobs yet. Add or schedule jobs in the <strong style={{ color: 'var(--accent)' }}>Service Jobs</strong> tab.</>,
      warningLabel: "included",
    }
    : {
      title: "Completed Jobs Only",
      description: "Actual payroll mode includes completed jobs only, and each job pays only its assigned active team members.",
      empty: <>No completed service jobs yet. Mark jobs completed in the <strong style={{ color: 'var(--accent)' }}>Service Jobs</strong> tab to include them in payroll.</>,
      warningLabel: "completed",
    };

  const updateEmployee = (id, patch) => {
    setEmployees(p => p.map(e => e.id === id ? { ...e, ...patch } : e));
  };
  const saveEmployee = async (id, patch) => {
    setRequestError("");
    const base = employees.find(e => e.id === id);
    if (!base) return;
    const updated = { ...base, ...patch };
    try { await apiFetch(`/api/v1/employees/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) }); }
    catch (err) { setRequestError(err?.message || "Failed to save employee."); }
  };
  const updateAndSaveEmployee = (id, patch) => {
    updateEmployee(id, patch);
    saveEmployee(id, patch);
  };
  const removeEmployee = async id => {
    setRequestError("");
    try { await apiFetch(`/api/v1/employees/${id}`, { method: 'DELETE' }); setEmployees(p => p.filter(e => e.id !== id)); }
    catch (err) { setRequestError(err?.message || "Failed to delete employee."); }
  };
  const addEmployee = async team => {
    setRequestError("");
    const count = employees.filter(e => e.team === team).length;
    const body = defaultEmployee(team, count, team === "owner" ? { getsAdminOverride: true, getsMarketingOverride: true } : {});
    try { const created = await apiFetch('/api/v1/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setEmployees(p => [...p, created]); }
    catch { setEmployees(p => [...p, body]); }
  };
  const updateJobGross = (id, val) => {
    const amount = Number(val) || 0;
    setServiceJobs(p => p.map(j => j.id === id ? { ...j, actualAmount: amount } : j));
  };
  const saveJobGross = async (id, val) => {
    setRequestError("");
    const amount = Number(val) || 0;
    const job = serviceJobs.find(j => j.id === id);
    if (job) try { await apiFetch(`/api/v1/jobs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...job, actualAmount: amount }) }); }
      catch (err) { setRequestError(err?.message || "Failed to save job gross."); }
  };
  const updateJobSpent = (id, val) => {
    const amount = Number(val) || 0;
    setServiceJobs(p => p.map(j => j.id === id ? { ...j, overheadSpent: amount } : j));
  };
  const saveJobSpent = async (id, val) => {
    setRequestError("");
    const amount = Number(val) || 0;
    const job = serviceJobs.find(j => j.id === id);
    if (job) try { await apiFetch(`/api/v1/jobs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...job, overheadSpent: amount }) }); }
      catch (err) { setRequestError(err?.message || "Failed to save job overhead."); }
  };

  const periodLabel = startDate || endDate ? `${startDate || 'open'}--${endDate || 'open'}` : 'all';
  const exportJSON = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ serviceJobs, ownerAdminOverrideEnabled, ownerMarketingOverrideEnabled, employees }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "ccs-payout-data.json"; a.click();
  };
  const exportCSV = () => {
    const headers = ["Name", "Team", "Status", "Base Pay", "Override Pay", "Overhead Bonus", "Total Pay"];
    const rows = result.paymentRows.map(r => [`"${r.name}"`, r.team, r.active ? "Active" : "Excluded", r.basePay.toFixed(2), r.overridePay.toFixed(2), r.bonusPay.toFixed(2), r.totalPay.toFixed(2)]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "ccs-payout-report.csv"; a.click();
  };
  const closePayrollRun = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const snapshot = {
      closedAt: new Date().toISOString(),
      period: { startDate: startDate || null, endDate: endDate || null },
      mode: payrollMode,
      totals: result.totals,
      paymentRows: result.paymentRows.map(r => ({ name: r.name, team: r.team, basePay: r.basePay, overridePay: r.overridePay, bonusPay: r.bonusPay, totalPay: r.totalPay })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `payroll-run-${stamp}-${periodLabel}.json`; a.click();
  };
  const importJSON = e => {
    setErrorMsg(null);
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (typeof data !== 'object' || data === null || Array.isArray(data))
          throw new Error('Root must be an object.');

        if (data.serviceJobs !== undefined) {
          if (!Array.isArray(data.serviceJobs)) throw new Error('serviceJobs must be an array.');
          const jobs = data.serviceJobs.map((j, i) => {
            if (typeof j !== 'object' || j === null) throw new Error(`serviceJobs[${i}] is not an object.`);
            return {
              id: String(j.id ?? uid()),
              jobNumber: Number(j.jobNumber) || 0,
              customerId: String(j.customerId ?? ''),
              address: String(j.address ?? ''),
              serviceType: String(j.serviceType ?? ''),
              serviceCategory: String(j.serviceCategory ?? j.service_category ?? ''),
              frequency: String(j.frequency ?? ''),
              quotedAmount: Number(j.quotedAmount) || 0,
              actualAmount: Number(j.actualAmount) || 0,
              overheadSpent: Number(j.overheadSpent) || 0,
              status: ['Estimate', 'Scheduled', 'In Progress', 'Completed', 'Cancelled'].includes(j.status) ? j.status : 'Scheduled',
              scheduledDate: String(j.scheduledDate ?? ''),
              assignedEmployeeIds: Array.isArray(j.assignedEmployeeIds) ? j.assignedEmployeeIds.map(String) : [],
              notes: String(j.notes ?? ''),
              gcalEventId: String(j.gcalEventId ?? ''),
              paymentStatus: getJobPaymentStatus(j),
              invoiceSent: isJobInvoiceSent(j),
            };
          });
          setServiceJobs(jobs);
        }

        if (data.employees !== undefined) {
          if (!Array.isArray(data.employees)) throw new Error('employees must be an array.');
          const emps = data.employees.map((emp, i) => {
            if (typeof emp !== 'object' || emp === null) throw new Error(`employees[${i}] is not an object.`);
            return {
              id: String(emp.id ?? uid()),
              name: String(emp.name ?? '').slice(0, 100),
              team: ['labor', 'admin', 'marketing', 'owner'].includes(emp.team) ? emp.team : 'labor',
              active: Boolean(emp.active),
              includedInLabor: Boolean(emp.includedInLabor),
              getsAdminOverride: Boolean(emp.getsAdminOverride),
              getsMarketingOverride: Boolean(emp.getsMarketingOverride),
              laborWeight: Number(emp.laborWeight) || 1,
              adminWeight: Number(emp.adminWeight) || 1,
              marketingWeight: Number(emp.marketingWeight) || 1,
            };
          });
          setEmployees(emps);
        }

        if (data.ownerAdminOverrideEnabled !== undefined)
          setOwnerAdminOverrideEnabled(Boolean(data.ownerAdminOverrideEnabled));
        if (data.ownerMarketingOverrideEnabled !== undefined)
          setOwnerMarketingOverrideEnabled(Boolean(data.ownerMarketingOverrideEnabled));
      } catch (err) { setErrorMsg(`Import failed: ${err.message}`); }
      e.target.value = null;
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="title-row">
        <div><div className="pill">Payroll Module</div><h2>Team Payout + Overhead Bonus Calculator</h2><div className="sub">Switch between actual payroll and active-job projection without leaving this screen.</div></div>
        <div className="flex-row">
          <button className="btn btn-sm" onClick={() => fileInputRef.current.click()}>Load JSON</button>
          <input type="file" accept=".json" style={{ display: 'none' }} ref={fileInputRef} onChange={importJSON} />
          <button className="btn btn-sm" onClick={exportJSON}>Save JSON</button>
          <button className="btn btn-sm btn-danger" onClick={exportCSV}>Export CSV</button>
        </div>
      </div>
      <div className="note" style={{ marginTop: 0, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>View Mode: {modeMeta.title}</div>
            <div className="small">{modeMeta.description}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              From <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '4px 8px', fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              To <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '4px 8px', fontSize: 13 }} />
            </label>
            {(startDate || endDate) && <button className="btn btn-sm" onClick={() => { setStartDate(""); setEndDate(""); }}>Clear Dates</button>}
          </div>
        </div>
        <div className="flex-row">
          <button className={`btn btn-sm ${payrollMode === "completed" ? 'btn-accent' : ''}`} onClick={() => setPayrollMode("completed")}>Completed Jobs</button>
          <button className={`btn btn-sm ${payrollMode === "active" ? 'btn-accent' : ''}`} onClick={() => setPayrollMode("active")}>All Active Jobs</button>
          <button className="btn btn-sm btn-accent" onClick={closePayrollRun} title="Snapshot current results to a timestamped JSON file">Close Run â†“</button>
        </div>
      </div>
      {errorMsg && <div className="alert">{errorMsg}</div>}
      {requestError && <div className="alert">{requestError}</div>}

      {(() => {
        const activeEmpIds = new Set(employees.filter(e => e.active).map(e => String(e.id)));
        const noAssigneeJobs = result.jobBreakdowns.filter(j => j.flags.noActiveAssignees);
        const zeroGrossJobs = payrollJobs.filter(j => getPayrollJobAmount(j) === 0);
        const overspentJobs = payrollJobs.filter(j => (Number(j.overheadSpent) || 0) > getPayrollJobAmount(j) && getPayrollJobAmount(j) > 0);
        const inactiveOverrideEmps = employees.filter(e => !e.active && (e.getsAdminOverride || e.getsMarketingOverride));
        const overrideNoWork = result.paymentRows.filter(r => r.overridePay > 0 && r.basePay === 0);
        const total = noAssigneeJobs.length + zeroGrossJobs.length + overspentJobs.length + inactiveOverrideEmps.length + overrideNoWork.length;
        if (total === 0) return null;
        return (
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Exceptions â€” Fix Queue ({total})</strong>
            {noAssigneeJobs.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <strong>No active assignees ({noAssigneeJobs.length}):</strong>{' '}
                {noAssigneeJobs.map(j => `#${j.jobNumber || j.id.slice(0, 5)} ${j.serviceType}`).join(', ')} â€” assign team members or gross stays unallocated.
              </div>
            )}
            {zeroGrossJobs.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <strong>$0 gross ({zeroGrossJobs.length}):</strong>{' '}
                {zeroGrossJobs.map(j => `#${j.jobNumber || j.id.slice(0, 5)}`).join(', ')} â€” enter actual or quoted amounts.
              </div>
            )}
            {overspentJobs.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <strong>Overhead exceeds gross ({overspentJobs.length}):</strong>{' '}
                {overspentJobs.map(j => `#${j.jobNumber || j.id.slice(0, 5)} (spent ${money(Number(j.overheadSpent))} vs ${money(getPayrollJobAmount(j))} gross)`).join(', ')} â€” verify overhead entry.
              </div>
            )}
            {inactiveOverrideEmps.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <strong>Inactive employees with overrides ({inactiveOverrideEmps.length}):</strong>{' '}
                {inactiveOverrideEmps.map(e => e.name || 'Unnamed').join(', ')} â€” remove override flags or reactivate.
              </div>
            )}
            {overrideNoWork.length > 0 && (
              <div>
                <strong>Override recipients with $0 base pay ({overrideNoWork.length}):</strong>{' '}
                {overrideNoWork.map(r => r.name || 'Unnamed').join(', ')} â€” no contributing jobs in this period.
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid">
        <section className="card span-4">
          <div className="sticky-top">
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Job Revenue Inputs</h3>
            <div className="small" style={{ marginBottom: 12 }}>{modeMeta.description} Values save when you leave each field.</div>
            {payrollJobs.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 14, padding: '16px 0' }}>{modeMeta.empty}</div>
            ) : (
              <div>
                {payrollJobs.map((job, idx) => {
                  const assignedActiveCount = Array.isArray(job.assignedEmployeeIds)
                    ? job.assignedEmployeeIds.filter(id => employees.some(emp => emp.active && String(emp.id) === String(id))).length
                    : 0;
                  return (
                    <div key={job.id} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span>#{job.jobNumber || job.id.slice(0, 5)} - {job.serviceType}</span>
                        <span className={`badge ${jobStatusClass(job.status)}`} style={{ fontSize: 10 }}>{job.status}</span>
                      </div>
                      <div className="small" style={{ marginBottom: 6 }}>
                        {assignedActiveCount > 0 ? `${assignedActiveCount} active assignee${assignedActiveCount === 1 ? '' : 's'}` : 'No active assignees'}
                      </div>
                      <div className="row">
                        <div>{idx === 0 && <label>Gross (actual / quoted)</label>}<input type="number" min="0" step="0.01" value={getPayrollJobAmount(job)} onChange={e => updateJobGross(job.id, e.target.value)} onBlur={e => saveJobGross(job.id, e.target.value)} /></div>
                        <div>{idx === 0 && <label>Overhead Spent</label>}<input type="number" min="0" step="0.01" value={Number(job.overheadSpent) || 0} onChange={e => updateJobSpent(job.id, e.target.value)} onBlur={e => saveJobSpent(job.id, e.target.value)} /></div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="metric"><div className="k">Included Jobs</div><div className="v mono">{result.totals.jobCount}</div></div>
                  <div className="metric"><div className="k">Total Gross</div><div className="v mono">{money(result.totals.gross)}</div></div>
                  <div className="metric"><div className="k">Total Overhead Spent</div><div className="v mono">{money(result.totals.spent)}</div></div>
                </div>
              </div>
            )}
            <h3 style={{ marginTop: 18 }}>Override Pools</h3>
            {(() => {
              const adminRecipients = employees.filter(e => e.active && e.getsAdminOverride);
              const mktgRecipients = employees.filter(e => e.active && e.getsMarketingOverride);
              const requestedAdmin = ownerAdminOverrideEnabled && adminRecipients.length > 0 ? result.totals.gross * BASE.ownerAdminOverride : 0;
              const requestedMktg = ownerMarketingOverrideEnabled && mktgRecipients.length > 0 ? result.totals.gross * BASE.ownerMarketingOverride : 0;
              const adminCapped = requestedAdmin > 0 && result.totals.adminOverrideAmount < requestedAdmin - 0.001;
              const mktgCapped = requestedMktg > 0 && result.totals.marketingOverrideAmount < requestedMktg - 0.001;
              const adminPerPerson = adminRecipients.length > 0 ? result.totals.adminOverrideAmount / adminRecipients.length : 0;
              const mktgPerPerson = mktgRecipients.length > 0 ? result.totals.marketingOverrideAmount / mktgRecipients.length : 0;
              return (
                <div>
                  <div className="note" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ownerAdminOverrideEnabled ? 6 : 0 }}>
                      <label style={{ fontWeight: 600 }}><input type="checkbox" checked={ownerAdminOverrideEnabled} onChange={e => setOwnerAdminOverrideEnabled(e.target.checked)} style={{ marginRight: 6 }} />Admin Override (2%)</label>
                      <span className="mono small">{money(result.totals.adminOverrideAmount)}</span>
                    </div>
                    {ownerAdminOverrideEnabled && (
                      <div className="small" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
                        2% Ã— {money(result.totals.gross)} = {money(requestedAdmin)} requested<br />
                        {adminCapped ? <span style={{ color: 'var(--warn)' }}>Capped â€” admin base only {money(result.totals.adminBase)}</span> : `Admin pool: ${money(result.totals.adminBase)} â€” not capped`}<br />
                        {adminRecipients.length > 0 ? <>Recipients: {adminRecipients.map(e => e.name || 'Unnamed').join(', ')} â€” {money(adminPerPerson)} each</> : <span style={{ color: 'var(--warn)' }}>No recipients â€” override inactive</span>}
                      </div>
                    )}
                  </div>
                  <div className="note">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ownerMarketingOverrideEnabled ? 6 : 0 }}>
                      <label style={{ fontWeight: 600 }}><input type="checkbox" checked={ownerMarketingOverrideEnabled} onChange={e => setOwnerMarketingOverrideEnabled(e.target.checked)} style={{ marginRight: 6 }} />Marketing Override (2%)</label>
                      <span className="mono small">{money(result.totals.marketingOverrideAmount)}</span>
                    </div>
                    {ownerMarketingOverrideEnabled && (
                      <div className="small" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
                        2% Ã— {money(result.totals.gross)} = {money(requestedMktg)} requested<br />
                        {mktgCapped ? <span style={{ color: 'var(--warn)' }}>Capped â€” marketing base only {money(result.totals.marketingBase)}</span> : `Marketing pool: ${money(result.totals.marketingBase)} â€” not capped`}<br />
                        {mktgRecipients.length > 0 ? <>Recipients: {mktgRecipients.map(e => e.name || 'Unnamed').join(', ')} â€” {money(mktgPerPerson)} each</> : <span style={{ color: 'var(--warn)' }}>No recipients â€” override inactive</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            <h3 style={{ marginTop: 18 }}>Allocation Summary</h3>
            <div className="metric"><div className="k">Labor pool ({pct(result.dynPercents.labor)})</div><div className="v mono">{money(result.totals.laborBase)}</div></div>
            <div className="metric"><div className="k">Admin net pool</div><div className="v mono">{money(result.totals.adminNetPool)}</div></div>
            <div className="metric"><div className="k">Marketing net pool</div><div className="v mono">{money(result.totals.marketingNetPool)}</div></div>
            <div className="metric"><div className="k">Overhead reserve (10%)</div><div className="v mono">{money(result.totals.overheadBase)}</div></div>
            <div className="metric"><div className="k">Overhead bonus pool</div><div className="v mono good">{money(result.totals.overheadBonusPool)}</div></div>
            <div className="metric"><div className="k">Overhead shortfall</div><div className="v mono danger">{money(result.totals.overheadShortfall)}</div></div>
          </div>
        </section>

        <section className="card span-8">
          <h3>Team Members</h3>
          {(result.flags.shiftedAdminJobs > 0 || result.flags.shiftedMarketingJobs > 0 || result.flags.unassignedJobs > 0) && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>Payroll Warnings:</strong>
              {result.flags.shiftedAdminJobs > 0 && <div>{result.flags.shiftedAdminJobs} {modeMeta.warningLabel} job{result.flags.shiftedAdminJobs === 1 ? '' : 's'} had no assigned Admin member, so 15% shifted to Labor on those jobs.</div>}
              {result.flags.shiftedMarketingJobs > 0 && <div>{result.flags.shiftedMarketingJobs} {modeMeta.warningLabel} job{result.flags.shiftedMarketingJobs === 1 ? '' : 's'} had no assigned Marketing member, so 5% shifted to Labor on those jobs.</div>}
              {result.flags.unassignedJobs > 0 && <div>{result.flags.unassignedJobs} {modeMeta.warningLabel} job{result.flags.unassignedJobs === 1 ? '' : 's'} had no assigned active payroll members, leaving {money(result.totals.unallocatedBase)} unallocated.</div>}
            </div>
          )}
          <div className="row4" style={{ marginBottom: 12 }}>
            <button className="btn" onClick={() => addEmployee("owner")}>+ Owner</button>
            <button className="btn" onClick={() => addEmployee("labor")}>+ Labor</button>
            <button className="btn" onClick={() => addEmployee("admin")}>+ Admin</button>
            <button className="btn" onClick={() => addEmployee("marketing")}>+ Marketing</button>
          </div>
          {employees.map(emp => {
            const pData = result.paymentRows.find(r => r.id === emp.id) || {};
            const isDrilldown = drilldownEmployeeId === emp.id;
            const empJobs = result.jobBreakdowns.filter(j => j.employeeRows.some(r => r.id === emp.id));
            return (
              <div className="employee" key={emp.id}>
                <div className="employee-head">
                  <strong>{emp.name || "Unnamed"}</strong>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm" onClick={() => setDrilldownEmployeeId(isDrilldown ? null : emp.id)}>
                      {isDrilldown ? 'Hide Breakdown' : 'Show Breakdown'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => removeEmployee(emp.id)}>Remove</button>
                  </div>
                </div>
                <div className="row3">
                  <div><label>Name</label><input value={emp.name} onChange={e => updateEmployee(emp.id, { name: e.target.value })} onBlur={e => saveEmployee(emp.id, { name: e.target.value })} /></div>
                  <div><label>Role</label><select value={emp.team} onChange={e => updateAndSaveEmployee(emp.id, { team: e.target.value })}><option value="owner">Owner</option><option value="labor">Labor</option><option value="admin">Admin</option><option value="marketing">Marketing</option></select></div>
                  <div><label>Active</label><select value={String(emp.active)} onChange={e => updateAndSaveEmployee(emp.id, { active: e.target.value === "true" })}><option value="true">Yes</option><option value="false">No</option></select></div>
                </div>
                <div className="checkbox-group" style={{ marginTop: 12, marginBottom: 4 }}>
                  <label><input type="checkbox" checked={emp.includedInLabor} onChange={e => updateAndSaveEmployee(emp.id, { includedInLabor: e.target.checked })} /> Included in labor</label>
                  <label><input type="checkbox" checked={emp.getsAdminOverride} onChange={e => updateAndSaveEmployee(emp.id, { getsAdminOverride: e.target.checked })} /> Admin override</label>
                  <label><input type="checkbox" checked={emp.getsMarketingOverride} onChange={e => updateAndSaveEmployee(emp.id, { getsMarketingOverride: e.target.checked })} /> Mktg override</label>
                </div>
                <div className="row3" style={{ marginTop: 12 }}>
                  {(emp.team === 'labor' || emp.includedInLabor) && <div><label>Labor Weight ({pct(pData.laborPct || 0)})</label><input type="number" min="0" value={emp.laborWeight} onChange={e => updateEmployee(emp.id, { laborWeight: e.target.value })} onBlur={e => saveEmployee(emp.id, { laborWeight: e.target.value })} /></div>}
                  {emp.team === 'admin' && <div><label>Admin Weight ({pct(pData.adminPct || 0)})</label><input type="number" min="0" value={emp.adminWeight} onChange={e => updateEmployee(emp.id, { adminWeight: e.target.value })} onBlur={e => saveEmployee(emp.id, { adminWeight: e.target.value })} /></div>}
                  {emp.team === 'marketing' && <div><label>Mktg Weight ({pct(pData.marketingPct || 0)})</label><input type="number" min="0" value={emp.marketingWeight} onChange={e => updateEmployee(emp.id, { marketingWeight: e.target.value })} onBlur={e => saveEmployee(emp.id, { marketingWeight: e.target.value })} /></div>}
                </div>
                <div className="row4" style={{ marginTop: 12 }}>
                  <div className="note" style={{ marginTop: 0 }}><div className="small">Base pay</div><div className="v mono">{money(pData.basePay || 0)}</div></div>
                  <div className="note" style={{ marginTop: 0 }}><div className="small">Override</div><div className="v mono">{money(pData.overridePay || 0)}</div></div>
                  <div className="note" style={{ marginTop: 0 }}><div className="small">Bonus</div><div className="v mono">{money(pData.bonusPay || 0)}</div></div>
                  <div className="note" style={{ marginTop: 0 }}><div className="small">Total</div><div className="v mono good">{money(pData.totalPay || 0)}</div></div>
                </div>
                {isDrilldown && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                      Why {emp.name || 'this employee'} earned {money(pData.totalPay || 0)}
                    </div>
                    {empJobs.length === 0 ? (
                      <div className="small" style={{ color: 'var(--muted)' }}>No contributing jobs in this period.</div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table>
                          <thead><tr><th>Job</th><th>Date</th><th>Labor</th><th>Admin</th><th>Mktg</th><th>Base</th><th>OH Bonus</th><th>From Job</th></tr></thead>
                          <tbody>
                            {empJobs.map(j => {
                              const row = j.employeeRows.find(r => r.id === emp.id);
                              if (!row) return null;
                              return (
                                <tr key={j.id}>
                                  <td>#{j.jobNumber || j.id.slice(0, 5)} {j.serviceType}</td>
                                  <td className="small">{j.scheduledDate || 'â€”'}</td>
                                  <td className="mono">{money(row.laborBasePay)}</td>
                                  <td className="mono">{money(row.adminBasePay)}</td>
                                  <td className="mono">{money(row.marketingBasePay)}</td>
                                  <td className="mono">{money(row.basePay)}</td>
                                  <td className="mono">{money(row.bonusPay)}</td>
                                  <td className="mono good">{money(row.totalPay)}</td>
                                </tr>
                              );
                            })}
                            {(pData.overridePay || 0) > 0 && (
                              <tr style={{ borderTop: '1px solid var(--border)' }}>
                                <td colSpan={7} style={{ color: 'var(--muted)', fontSize: 12 }}>Override (admin/mktg â€” global, not per-job)</td>
                                <td className="mono">{money(pData.overridePay)}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="card span-12">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Per-Job Payroll Breakdown</h3>
              <div className="small">Base pay and overhead bonus are shown per job. Global owner overrides stay in the overall payment table below.</div>
            </div>
          </div>
          {result.jobBreakdowns.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>{modeMeta.empty}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {result.jobBreakdowns.map(job => (
                <div key={job.id} className="note" style={{ marginTop: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap', marginBottom: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <strong>#{job.jobNumber || job.id.slice(0, 5)} - {job.serviceType}</strong>
                        <span className={`badge ${jobStatusClass(job.status)}`}>{job.status || 'Job'}</span>
                        {job.flags.noActiveAssignees && <span className="badge badge-warn">No Active Assignees</span>}
                        {job.flags.shiftedAdmin && <span className="badge">Admin Shifted</span>}
                        {job.flags.shiftedMarketing && <span className="badge">Mktg Shifted</span>}
                      </div>
                      <div className="small">
                        {[job.scheduledDate, job.address].filter(Boolean).join(" | ") || "No schedule/address set"}
                      </div>
                    </div>
                    <div className="small" style={{ textAlign: 'right' }}>
                      <div>Gross: <span className="mono">{money(job.gross)}</span></div>
                      <div>Overhead Spent: <span className="mono">{money(job.spent)}</span></div>
                    </div>
                  </div>

                  <div className="row4" style={{ marginBottom: 12 }}>
                    <div className="metric"><div className="k">Labor</div><div className="v mono">{money(job.totals.laborBase)}</div></div>
                    <div className="metric"><div className="k">Admin Net</div><div className="v mono">{money(job.totals.adminNetPool)}</div></div>
                    <div className="metric"><div className="k">Mktg Net</div><div className="v mono">{money(job.totals.marketingNetPool)}</div></div>
                    <div className="metric"><div className="k">OH Bonus Share</div><div className="v mono">{money(job.totals.bonusPay)}</div></div>
                  </div>

                  {job.employeeRows.length === 0 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 14 }}>No assigned active employees are being paid from this job yet.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table>
                        <thead><tr><th>Employee</th><th>Role</th><th>Labor</th><th>Admin</th><th>Mktg</th><th>Base</th><th>OH Bonus</th><th>Total From Job</th></tr></thead>
                        <tbody>
                          {job.employeeRows.map(row => (
                            <tr key={`${job.id}-${row.id}`}>
                              <td>{row.name}{row.includedInLabor && row.team !== 'labor' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>+ Labor share</div>}</td>
                              <td><span className="badge">{row.team}</span></td>
                              <td className="mono">{money(row.laborBasePay)}</td>
                              <td className="mono">{money(row.adminBasePay)}</td>
                              <td className="mono">{money(row.marketingBasePay)}</td>
                              <td className="mono">{money(row.basePay)}</td>
                              <td className="mono">{money(row.bonusPay)}</td>
                              <td className="mono good">{money(row.totalPay)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {job.totals.unallocatedBase > 0 && (
                    <div className="small" style={{ marginTop: 10, color: 'var(--warn)' }}>Unallocated from this job: {money(job.totals.unallocatedBase)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card span-12" style={{ overflowX: 'auto' }}>
          <h3>Overall Payment Table</h3>
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Base Pay</th><th>Overrides</th><th>OH Bonus</th><th>Total Pay</th></tr></thead>
            <tbody>
              {result.paymentRows.map(row => (
                <tr key={row.id}>
                  <td>{row.name}{row.includedInLabor && row.team !== 'labor' && <div style={{ fontSize: 11, color: 'var(--muted)' }}>+ Labor share</div>}</td>
                  <td><span className="badge">{row.team}</span></td>
                  <td>{row.active ? "Active" : "Excluded"}</td>
                  <td className="mono">{money(row.basePay)}</td>
                  <td className="mono">{money(row.overridePay)}</td>
                  <td className="mono">{money(row.bonusPay)}</td>
                  <td className="mono good">{money(row.totalPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

// â”€â”€â”€ DASHBOARD TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DashboardTab({ customers, serviceJobs, setServiceJobs, setActiveTab, navigateTo, calAuth = false }) {
  const customerById = useMemo(() => {
    const next = new Map();
    (customers || []).forEach(customer => next.set(String(customer.id), customer));
    return next;
  }, [customers]);
  const [activitySummary, setActivitySummary] = useState([]);
  const [intakeImports, setIntakeImports] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [intakeLoading, setIntakeLoading] = useState(true);
  const [dashboardActionError, setDashboardActionError] = useState('');

  const todayStr = useMemo(() => toLocalISODate(), []);
  const tomorrowStr = useMemo(() => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    return toLocalISODate(next);
  }, []);
  const monthPrefix = useMemo(() => todayStr.slice(0, 7), [todayStr]);
  const getJobTimelineValue = job => String(job?.completedAt || job?.scheduledDate || job?.createdAt || '').trim();
  const getCustomerForJob = job => customerById.get(String(job?.customerId));
  const getCustomerNameForJob = job => String(getCustomerForJob(job)?.name || 'Unknown Customer');
  const getCustomerAddressForJob = job => {
    const customer = getCustomerForJob(job);
    return customer ? buildCustomerRouteAddress(customer) : String(job?.address || '').trim();
  };
  const parseDateValue = value => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const todayJobs = useMemo(() => (
    [...(serviceJobs || [])]
      .filter(job => (job.scheduledDate === todayStr || job.scheduledDate === tomorrowStr) && (job.status === "Scheduled" || job.status === "In Progress"))
      .sort((a, b) => {
        const aCustomer = getCustomerNameForJob(a);
        const bCustomer = getCustomerNameForJob(b);
        if (a.scheduledDate !== b.scheduledDate) return String(a.scheduledDate).localeCompare(String(b.scheduledDate));
        return aCustomer.localeCompare(bCustomer);
      })
  ), [serviceJobs, todayStr, tomorrowStr, customerById]);

  const dashboardMarkPaid = async job => {
    if (!job?.id) return;
    setDashboardActionError('');
    const updated = withJobFinancialDefaults({ ...job, paymentStatus: 'paid', invoiceSent: true });
    try {
      const res = await apiFetch(`/api/v1/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const savedJob = withJobFinancialDefaults(res || updated);
      setServiceJobs(prev => prev.map(item => item.id === job.id ? savedJob : item));
    } catch (err) {
      setDashboardActionError(err?.message || 'Failed to mark job paid.');
    }
  };

  const dashboardCompleteJob = async job => {
    if (!job?.id) return;
    setDashboardActionError('');
    const updated = withJobFinancialDefaults({ ...job, status: 'Completed' });
    try {
      const res = await apiFetch(`/api/v1/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const savedJob = withJobFinancialDefaults(res || updated);
      setServiceJobs(prev => prev.map(item => item.id === job.id ? savedJob : item));
    } catch (err) {
      setDashboardActionError(err?.message || 'Failed to mark job completed.');
    }
  };

  const dashboardMarkInvoiceSent = async job => {
    if (!job?.id) return;
    setDashboardActionError('');
    const updated = withJobFinancialDefaults({ ...job, invoiceSent: true });
    try {
      const res = await apiFetch(`/api/v1/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      const savedJob = withJobFinancialDefaults(res || updated);
      setServiceJobs(prev => prev.map(item => item.id === job.id ? savedJob : item));
    } catch (err) {
      setDashboardActionError(err?.message || 'Failed to flag invoice as sent.');
    }
  };

  const completedJobs = useMemo(() => (serviceJobs || []).filter(job => job.status === "Completed"), [serviceJobs]);
  const paidCompletedJobs = useMemo(() => completedJobs.filter(isJobPaid), [completedJobs]);
  const unpaidJobs = useMemo(() => completedJobs.filter(job => !isJobPaid(job)), [completedJobs]);
  const outstandingAR = useMemo(() => unpaidJobs.reduce((sum, job) => sum + getPayrollJobAmount(job), 0), [unpaidJobs]);
  const pendingEstimatesValue = useMemo(() => (
    (serviceJobs || [])
      .filter(job => job.status === "Estimate")
      .reduce((sum, job) => sum + (Number(job.quotedAmount) || 0), 0)
  ), [serviceJobs]);
  const dashboardNavigate = useCallback((moduleId, subviewId, legacyFallback) => {
    if (typeof navigateTo === 'function') {
      navigateTo(moduleId, subviewId);
      return;
    }
    if (legacyFallback) setActiveTab(legacyFallback);
  }, [navigateTo, setActiveTab]);
  const loadActivitySummary = useCallback(async () => {
    setActivityLoading(true);
    setIntakeLoading(true);
    try {
      const [rows, intakeData] = await Promise.all([
        apiFetch('/api/v1/customers/activity-summary?limit=250', undefined, { silent: true }),
        apiFetch('/api/v1/intake-imports?limit=50', { method: 'GET' }, { silent: true }),
      ]);
      setActivitySummary(Array.isArray(rows) ? rows : []);
      setIntakeImports(Array.isArray(intakeData?.imports) ? intakeData.imports : []);
    } finally {
      setActivityLoading(false);
      setIntakeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivitySummary();
  }, [loadActivitySummary]);

  const openFollowupCount = useMemo(() => (
    (activitySummary || []).reduce((sum, item) => sum + (Number(item?.openFollowupCount) || 0), 0)
  ), [activitySummary]);
  const activityByCustomerId = useMemo(() => {
    const next = new Map();
    (activitySummary || []).forEach(item => next.set(String(item?.customerId), item));
    return next;
  }, [activitySummary]);
  const tomorrowJobs = useMemo(() => (
    [...(serviceJobs || [])]
      .filter(job => job.scheduledDate === tomorrowStr && job.status !== "Completed" && job.status !== "Cancelled")
      .sort((a, b) => {
        const aCustomer = getCustomerNameForJob(a);
        const bCustomer = getCustomerNameForJob(b);
        if (a.scheduledDate !== b.scheduledDate) return String(a.scheduledDate).localeCompare(String(b.scheduledDate));
        return aCustomer.localeCompare(bCustomer);
      })
  ), [serviceJobs, tomorrowStr, customerById]);
  const todayTomorrowJobs = useMemo(() => (
    [...todayJobs, ...tomorrowJobs]
      .filter(job => job.status === 'Scheduled' || job.status === 'In Progress')
      .sort((a, b) => {
        if (a.scheduledDate !== b.scheduledDate) return String(a.scheduledDate).localeCompare(String(b.scheduledDate));
        return getCustomerNameForJob(a).localeCompare(getCustomerNameForJob(b));
      })
  ), [todayJobs, tomorrowJobs, customerById]);
  const openIntakeImports = useMemo(() => (
    [...(intakeImports || [])]
      .filter(item => String(item?.intakeStatus || '').trim().toLowerCase() !== 'converted')
      .sort((a, b) => String(b?.submittedAt || b?.importedAt || '').localeCompare(String(a?.submittedAt || a?.importedAt || '')))
  ), [intakeImports]);
  const upcomingRevenue = useMemo(() => (
    [...(serviceJobs || [])]
      .filter(job => (job.status === 'Scheduled' || job.status === 'In Progress') && String(job?.scheduledDate || '') >= todayStr)
      .reduce((sum, job) => sum + getPayrollJobAmount(job), 0)
  ), [serviceJobs, todayStr]);
  const thisMonthRevenue = useMemo(() => (
    paidCompletedJobs
      .filter(job => getJobTimelineValue(job).startsWith(monthPrefix))
      .reduce((sum, job) => sum + getPayrollJobAmount(job), 0)
  ), [paidCompletedJobs, monthPrefix]);
  const followupsDueRows = useMemo(() => {
    return [...(Array.isArray(activitySummary) ? activitySummary : [])]
      .filter(item => {
        const dueAt = String(item?.nextFollowup?.dueAt || '').trim();
        return dueAt && dueAt.slice(0, 10) <= todayStr;
      })
      .sort((a, b) => ledgerSortValue(a?.nextFollowup?.dueAt, Number.POSITIVE_INFINITY) - ledgerSortValue(b?.nextFollowup?.dueAt, Number.POSITIVE_INFINITY));
  }, [activitySummary, todayStr]);
  const estimateFollowupRows = useMemo(() => {
    return [...(serviceJobs || [])]
      .filter(job => job.status === 'Estimate')
      .map(job => ({ job, activity: activityByCustomerId.get(String(job.customerId)) || null }))
      .sort((a, b) => {
        const aDue = ledgerSortValue(a.activity?.nextFollowup?.dueAt, Number.POSITIVE_INFINITY);
        const bDue = ledgerSortValue(b.activity?.nextFollowup?.dueAt, Number.POSITIVE_INFINITY);
        if (aDue !== bDue) return aDue - bDue;
        return ledgerSortValue(getJobTimelineValue(a.job), Number.POSITIVE_INFINITY) - ledgerSortValue(getJobTimelineValue(b.job), Number.POSITIVE_INFINITY);
      });
  }, [serviceJobs, activityByCustomerId]);
  const jobConfirmationJobs = useMemo(() => (
    todayTomorrowJobs.filter(job => job.status === 'Scheduled')
  ), [todayTomorrowJobs]);
  const paymentIssueJobs = useMemo(() => {
    return [...completedJobs]
      .filter(job => !isJobPaid(job) || !isJobInvoiceSent(job))
      .sort((a, b) => ledgerSortValue(getJobTimelineValue(b), Number.NEGATIVE_INFINITY) - ledgerSortValue(getJobTimelineValue(a), Number.NEGATIVE_INFINITY));
  }, [completedJobs]);
  const reviewRequestReadyJobs = useMemo(() => {
    const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return [...completedJobs].filter(job => {
      if (!isJobPaid(job) || !isJobInvoiceSent(job)) return false;
      const parsed = parseDateValue(getJobTimelineValue(job));
      if (!parsed) return false;
      const ageMs = now - parsed.getTime();
      return ageMs >= 0 && ageMs <= maxAgeMs;
    });
  }, [completedJobs]);
  const reviewRequestReadyIds = useMemo(() => new Set(reviewRequestReadyJobs.map(job => String(job.id))), [reviewRequestReadyJobs]);
  const calendarSyncFailedJobs = useMemo(() => (
    [...(serviceJobs || [])]
      .filter(job => (job.status === 'Scheduled' || job.status === 'In Progress') && String(job?.calendarSyncStatus || '').trim().toLowerCase() === 'failed')
      .sort((a, b) => String(a?.scheduledDate || '').localeCompare(String(b?.scheduledDate || '')))
  ), [serviceJobs]);
  const calendarAdminIssueCount = calendarSyncFailedJobs.length + (calAuth ? 0 : 1);
  const upcomingScheduledJobs = useMemo(() => (
    [...(serviceJobs || [])]
      .filter(job => (job.status === 'Scheduled' || job.status === 'In Progress') && String(job?.scheduledDate || '') >= todayStr)
      .sort((a, b) => {
        if (a.scheduledDate !== b.scheduledDate) return String(a.scheduledDate).localeCompare(String(b.scheduledDate));
        return getCustomerNameForJob(a).localeCompare(getCustomerNameForJob(b));
      })
      .slice(0, 10)
  ), [serviceJobs, todayStr, customerById]);
  const recentLeadCustomerRows = useMemo(() => {
    const importRows = openIntakeImports.map(item => ({
      id: `intake-${item.id}`,
      name: item?.leadSummary?.name || 'Website lead',
      subtitle: item?.leadSummary?.serviceCategory || item?.leadSummary?.address || 'Website intake waiting in queue',
      meta: formatLedgerTimestamp(item?.submittedAt || item?.importedAt),
      badgeLabel: item?.intakeStatus || 'imported',
      badgeClass: String(item?.intakeStatus || '').trim().toLowerCase() === 'reviewed' ? '' : 'badge-warn',
      route: ['estimates', 'intake_queue', 'intake_queue'],
      sortDate: ledgerSortValue(item?.submittedAt || item?.importedAt, Number.NEGATIVE_INFINITY),
      sortNumber: Number(item?.id) || 0,
    }));
    const customerRows = (customers || [])
      .filter(customer => {
        const status = String(customer?.status || '').trim().toLowerCase();
        return status === 'lead' || status === 'active';
      })
      .map(customer => {
        const status = String(customer?.status || '').trim().toLowerCase();
        return {
          id: `customer-${customer.id}`,
          name: customer?.name || `Customer ${customer.id}`,
          subtitle: buildCustomerRouteAddress(customer) || customer?.phone || customer?.email || 'CRM customer record',
          meta: customer?.customerNumber ? `Customer #${String(customer.customerNumber).padStart(4, '0')}` : 'CRM customer record',
          badgeLabel: status === 'lead' ? 'lead' : 'customer',
          badgeClass: status === 'lead' ? 'badge-warn' : 'badge-good',
          route: ['customers', 'directory', 'database'],
          sortDate: ledgerSortValue(customer?.createdAt || customer?.updatedAt, Number.NEGATIVE_INFINITY),
          sortNumber: Number(customer?.customerNumber) || Number(customer?.id) || 0,
        };
      });
    return [...importRows, ...customerRows]
      .sort((a, b) => {
        if (a.sortDate !== b.sortDate) return b.sortDate - a.sortDate;
        return b.sortNumber - a.sortNumber;
      })
      .slice(0, 10);
  }, [openIntakeImports, customers]);
  const completedJobsNeedingCloseout = useMemo(() => {
    return [...completedJobs]
      .filter(job => !isJobPaid(job) || !isJobInvoiceSent(job) || reviewRequestReadyIds.has(String(job.id)))
      .sort((a, b) => ledgerSortValue(getJobTimelineValue(b), Number.NEGATIVE_INFINITY) - ledgerSortValue(getJobTimelineValue(a), Number.NEGATIVE_INFINITY))
      .slice(0, 10);
  }, [completedJobs, reviewRequestReadyIds]);

  return (
    <div>
      <div className="title-row" style={{ marginBottom: 24 }}>
        <div>
          <div className="pill">Action Dashboard</div>
          <h2>Executive Dashboard</h2>
          <div className="sub">Refocused as the operating queue for intake, follow-up, dispatch, collections, and closeout.</div>
        </div>
        <div className="flex-row">
          <button className="btn btn-sm" onClick={() => dashboardNavigate('estimates', 'intake_queue', 'intake_queue')}>Open Intake Queue</button>
          <button className="btn btn-sm" onClick={() => dashboardNavigate('scheduling', 'dispatch_board', 'dispatch')}>Dispatch Board</button>
          <button className="btn btn-accent btn-sm" onClick={() => dashboardNavigate('jobs', 'active', 'jobs')}>Active Jobs</button>
        </div>
      </div>

      {dashboardActionError && (
        <div className="alert" style={{ marginBottom: 16 }}>{dashboardActionError}</div>
      )}

      {todayJobs.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderLeft: '4px solid var(--accent)', background: 'linear-gradient(180deg, rgba(110,168,254,0.08), rgba(110,168,254,0.03))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18 }}>Today / Tomorrow Jobs</h3>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
                {todayJobs.length} job{todayJobs.length === 1 ? '' : 's'} scheduled across today and tomorrow
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => dashboardNavigate('jobs', 'active', 'jobs')}>Active Jobs</button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {todayJobs.slice(0, 8).map(job => {
              const customer = customerById.get(String(job.customerId));
              return (
                <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge ${jobStatusClass(job.status)}`}>{job.status}</span>
                      <span className={`badge ${job.scheduledDate === todayStr ? 'badge-accent' : ''}`}>{job.scheduledDate === todayStr ? 'Today' : 'Tomorrow'}</span>
                      <span style={{ fontWeight: 700 }}>{customer?.name || 'Unknown Customer'}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 14 }}>{job.serviceType || 'Service Job'}</div>
                    <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
                      {[job.scheduledDate, customer ? buildCustomerRouteAddress(customer) : job.address].filter(Boolean).join(' | ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                    <button className="btn btn-sm btn-accent" onClick={() => dashboardCompleteJob(job)}>âœ“ Done</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid" style={{ marginBottom: 18 }}>
        <div className="card span-4" style={{ borderLeft: '4px solid var(--accent)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Today&apos;s Jobs</div>
          <div style={{ fontSize: 36, fontWeight: 800, margin: '8px 0' }}>{todayJobs.filter(job => job.scheduledDate === todayStr).length}</div>
          <div className="small" style={{ color: 'var(--muted)' }}>{tomorrowJobs.length} scheduled tomorrow</div>
        </div>

        <div className="card span-4" style={{ borderLeft: '4px solid var(--good)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upcoming Revenue</div>
          <div style={{ fontSize: 36, fontWeight: 800, margin: '8px 0' }}>{money(upcomingRevenue)}</div>
          <div className="small" style={{ color: 'var(--muted)' }}>{upcomingScheduledJobs.length} active scheduled jobs on the board</div>
        </div>

        <div className="card span-4" style={{ borderLeft: '4px solid var(--warn)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Open Estimates</div>
          <div style={{ fontSize: 36, fontWeight: 800, margin: '8px 0' }}>{estimateFollowupRows.length}</div>
          <div className="small" style={{ color: 'var(--muted)' }}>{money(pendingEstimatesValue)} still in estimate stage</div>
        </div>

        <div className="card span-4" style={{ borderLeft: '4px solid var(--danger)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Unpaid Balance</div>
          <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--danger)', margin: '8px 0' }}>{money(outstandingAR)}</div>
          <div className="small" style={{ color: 'var(--muted)' }}>{paymentIssueJobs.length} completed jobs need payment or invoice work</div>
        </div>

        <div className="card span-4" style={{ borderLeft: '4px solid var(--warn)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Follow-Ups Due</div>
          <div style={{ fontSize: 36, fontWeight: 800, margin: '8px 0' }}>{followupsDueRows.length}</div>
          <div className="small" style={{ color: 'var(--muted)' }}>{activityLoading ? 'Loading follow-up activity...' : 'Due today or overdue from customer communications'}</div>
        </div>

        <div className="card span-4" style={{ borderLeft: '4px solid var(--accent)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>This Month Revenue</div>
          <div style={{ fontSize: 36, fontWeight: 800, margin: '8px 0' }}>{money(thisMonthRevenue)}</div>
          <div className="small" style={{ color: 'var(--muted)' }}>{paidCompletedJobs.filter(job => getJobTimelineValue(job).startsWith(monthPrefix)).length} paid completions this month</div>
        </div>
      </div>

      <div className="grid" style={{ marginBottom: 18 }}>
        <div className="card span-5">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18 }}>Action Queue</h3>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>Cross-module triage without building a second dashboard.</div>
            </div>
            <button className="btn btn-sm" onClick={loadActivitySummary}>Refresh</button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>Website leads</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>
                  {intakeLoading ? 'Loading intake queue...' : (openIntakeImports[0]?.leadSummary?.name ? `Next up: ${openIntakeImports[0].leadSummary.name}` : 'No website leads waiting in queue')}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <span className={`badge ${openIntakeImports.length > 0 ? 'badge-warn' : 'badge-good'}`}>{openIntakeImports.length}</span>
                <button className="btn btn-sm" onClick={() => dashboardNavigate('estimates', 'intake_queue', 'intake_queue')}>Open</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>Estimate follow-ups</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>
                  {estimateFollowupRows[0]
                    ? `${getCustomerNameForJob(estimateFollowupRows[0].job)}${estimateFollowupRows[0].activity?.nextFollowup?.dueAt ? ` | due ${formatLedgerDate(estimateFollowupRows[0].activity.nextFollowup.dueAt)}` : ''}`
                    : 'No estimate-stage jobs are waiting on follow-up'}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <span className={`badge ${estimateFollowupRows.length > 0 ? 'badge-warn' : 'badge-good'}`}>{estimateFollowupRows.length}</span>
                <button className="btn btn-sm" onClick={() => dashboardNavigate('estimates', 'builder', 'builder')}>Open</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>Job confirmations</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>
                  {jobConfirmationJobs[0] ? `${getCustomerNameForJob(jobConfirmationJobs[0])} on ${jobConfirmationJobs[0].scheduledDate}` : 'No scheduled confirmations pending for today or tomorrow'}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <span className={`badge ${jobConfirmationJobs.length > 0 ? 'badge-warn' : 'badge-good'}`}>{jobConfirmationJobs.length}</span>
                <button className="btn btn-sm" onClick={() => dashboardNavigate('scheduling', 'dispatch_board', 'dispatch')}>Open</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>Payment issues</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>
                  {paymentIssueJobs[0] ? `${getCustomerNameForJob(paymentIssueJobs[0])} | ${money(getPayrollJobAmount(paymentIssueJobs[0]))}` : 'No unpaid or uninvoiced completed jobs'}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <span className={`badge ${paymentIssueJobs.length > 0 ? 'badge-warn' : 'badge-good'}`}>{paymentIssueJobs.length}</span>
                <button className="btn btn-sm" onClick={() => dashboardNavigate('jobs', 'outstanding', 'outstanding_jobs')}>Open</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>Review requests</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>
                  {reviewRequestReadyJobs[0] ? `${getCustomerNameForJob(reviewRequestReadyJobs[0])} is ready for review outreach` : 'No recent paid completions ready for review outreach'}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <span className={`badge ${reviewRequestReadyJobs.length > 0 ? 'badge-warn' : 'badge-good'}`}>{reviewRequestReadyJobs.length}</span>
                <button className="btn btn-sm" onClick={() => dashboardNavigate('customers', 'directory', 'database')}>Open</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>Calendar / admin issues</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 4 }}>
                  {!calAuth ? 'Google Calendar is not connected in Settings.' : (calendarSyncFailedJobs[0] ? `Sync failed on job #${calendarSyncFailedJobs[0].jobNumber || calendarSyncFailedJobs[0].id}` : 'No calendar sync failures detected')}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                <span className={`badge ${calendarAdminIssueCount > 0 ? 'badge-warn' : 'badge-good'}`}>{calendarAdminIssueCount}</span>
                <button className="btn btn-sm" onClick={() => dashboardNavigate('settings', 'general', 'settings')}>Open</button>
              </div>
            </div>
          </div>
        </div>

        <div className="card span-7">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18 }}>Upcoming 10 Scheduled Jobs</h3>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>Forward-looking dispatch list with current job value.</div>
            </div>
            <button className="btn btn-sm" onClick={() => dashboardNavigate('jobs', 'active', 'jobs')}>All Jobs</button>
          </div>
          {upcomingScheduledJobs.length === 0 ? (
            <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '32px 20px', background: 'var(--panel-soft)', borderRadius: '8px' }}>
              No scheduled jobs are on the board yet.
            </div>
          ) : (
            <table style={{ fontSize: 14, width: '100%', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: 'var(--muted)' }}>
                  <th style={{ paddingBottom: '12px' }}>Scheduled Date</th>
                  <th style={{ paddingBottom: '12px' }}>Customer</th>
                  <th style={{ paddingBottom: '12px' }}>Service Type</th>
                  <th style={{ paddingBottom: '12px' }}>Est. Value</th>
                </tr>
              </thead>
              <tbody>
                {upcomingScheduledJobs.map(job => (
                  <tr key={job.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td className="mono" style={{ padding: '12px 0', color: 'var(--accent)' }}>{job.scheduledDate}</td>
                    <td style={{ fontWeight: 600, padding: '12px 0' }}>{getCustomerNameForJob(job)}</td>
                    <td style={{ padding: '12px 0' }}>
                      <div>{job.serviceType}</div>
                      {getCustomerAddressForJob(job) && <div className="small" style={{ marginTop: 2 }}>{getCustomerAddressForJob(job)}</div>}
                    </td>
                    <td className="mono" style={{ padding: '12px 0', fontWeight: 600 }}>{money(getPayrollJobAmount(job))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid">
        <div className="card span-6">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px' }}>Recent 10 Leads / New Customers</h3>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>Website intake and recent CRM entries in one view.</div>
            </div>
            <button className="btn btn-sm" onClick={() => dashboardNavigate('customers', 'directory', 'database')}>Open CRM</button>
          </div>
          {recentLeadCustomerRows.length === 0 ? (
            <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '32px 20px', background: 'var(--panel-soft)', borderRadius: '8px' }}>
              No recent leads or customer additions are available.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {recentLeadCustomerRows.map(row => (
                <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className={`badge ${row.badgeClass}`}>{row.badgeLabel}</span>
                      <span style={{ fontWeight: 700 }}>{row.name}</span>
                    </div>
                    <div className="small" style={{ marginTop: 6, color: 'var(--muted)' }}>{row.subtitle}</div>
                    <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>{row.meta}</div>
                  </div>
                  <button className="btn btn-sm" onClick={() => dashboardNavigate(row.route[0], row.route[1], row.route[2])}>Open</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card span-6">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px' }}>Last 10 Completed Jobs Needing Closeout</h3>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>Payment, invoice, and review-outreach cleanup after completion.</div>
            </div>
            <button className="btn btn-sm btn-accent" onClick={() => dashboardNavigate('jobs', 'completed', 'completed')}>Completed Jobs</button>
          </div>
          {completedJobsNeedingCloseout.length === 0 ? (
            <div style={{ color: 'var(--good)', textAlign: 'center', padding: '32px 20px', background: 'rgba(64, 192, 87, 0.08)', borderRadius: '8px' }}>
              Completed jobs are closed out cleanly.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {completedJobsNeedingCloseout.map(job => {
                const paymentStatus = getJobPaymentStatus(job);
                const invoiceSent = isJobInvoiceSent(job);
                const reviewReady = reviewRequestReadyIds.has(String(job.id));
                return (
                  <div key={job.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="badge badge-completed">Completed</span>
                      <span style={{ fontWeight: 700 }}>{getCustomerNameForJob(job)}</span>
                    </div>
                    <div style={{ marginTop: 6 }}>{job.serviceType || 'Service job'}</div>
                    <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
                      {formatLedgerDate(getJobTimelineValue(job))} | {money(getPayrollJobAmount(job))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      <span className={`badge ${jobPaymentStatusClass(paymentStatus)}`}>{paymentStatus}</span>
                      <span className={`badge ${invoiceSent ? 'badge-good' : 'badge-warn'}`}>{invoiceSent ? 'Invoice sent' : 'Invoice needed'}</span>
                      {reviewReady && <span className="badge badge-warn">Review outreach</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      {!invoiceSent && <button className="btn btn-sm" onClick={() => dashboardMarkInvoiceSent(job)}>Invoice Sent</button>}
                      {!isJobPaid(job) && <button className="btn btn-sm btn-accent" onClick={() => dashboardMarkPaid(job)}>Mark Paid</button>}
                      {reviewReady && <button className="btn btn-sm" onClick={() => dashboardNavigate('customers', 'directory', 'database')}>Customer</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Follow-Ups Due</h3>
            <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
              {followupsDueRows.length} due today or overdue | {openFollowupCount} open follow-ups
            </div>
          </div>
          <button className="btn btn-sm btn-accent" onClick={() => dashboardNavigate('customers', 'directory', 'database')}>Open Customers</button>
        </div>
        {activityLoading ? (
          <div className="small" style={{ color: 'var(--muted)' }}>Loading customer contact activity...</div>
        ) : followupsDueRows.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '28px 20px', background: 'var(--panel-soft)', borderRadius: 8 }}>
            No follow-ups are due right now.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {followupsDueRows.map(item => {
              const customer = customerById.get(String(item.customerId));
              return (
                <div key={item.customerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{customer?.name || item.customerName || `Customer ${item.customerId}`}</div>
                    <div className="small" style={{ marginTop: 6, color: 'var(--muted)' }}>
                      Last contact: {item.lastContact ? `${formatLedgerEventTypeLabel(item.lastContact.eventType)} Â· ${formatLedgerTimestamp(item.lastContact.occurredAt)}` : 'No contact history'}
                    </div>
                    <div className="small" style={{ marginTop: 4, color: item.nextFollowup ? 'var(--warn)' : 'var(--muted)' }}>
                      Next follow-up: {item.nextFollowup ? `${formatLedgerDate(item.nextFollowup.dueAt)} Â· ${item.nextFollowup.subject || 'Follow-up'}` : 'None scheduled'}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                    {item.openFollowupCount > 0 && <span className="badge badge-warn">{item.openFollowupCount} open</span>}
                    {item.lastContact?.channel && <span className="badge" style={contactChannelStyles(item.lastContact.channel)}>{item.lastContact.channel}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// â”€â”€â”€ CUSTOMERS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CustomersTab({ customers, setCustomers, isInitialLoading, setActiveTab, setMapFocus, customerEditRequest, setCustomerEditRequest, setCustomerJobsRequest, canExecuteDelete = true, onRequestDelete = () => { } }) {
  const [modalCustomer, setModalCustomer] = useState(null);
  const [communicationsCustomer, setCommunicationsCustomer] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [requestError, setRequestError] = useState("");
  const [activitySummary, setActivitySummary] = useState([]);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return customers.slice(-10).reverse();
    const t = searchTerm.toLowerCase();
    return customers.filter(c => (c.name || "").toLowerCase().includes(t) || (c.phone || "").toLowerCase().includes(t) || (c.status || "").toLowerCase().includes(t) || (c.address || "").toLowerCase().includes(t));
  }, [customers, searchTerm]);
  const activitySummaryByCustomer = useMemo(() => {
    const next = new Map();
    (activitySummary || []).forEach(item => next.set(String(item.customerId), item));
    return next;
  }, [activitySummary]);
  const openCommunicationsLedger = useCallback(customerId => {
    const target = customers.find(customer => String(customer.id) === String(customerId));
    if (target) setCommunicationsCustomer(target);
  }, [customers]);
  const loadActivityData = useCallback(async () => {
    setActivityLoading(true);
    try {
      const [summaryRows, eventRows] = await Promise.all([
        apiFetch('/api/v1/customers/activity-summary?limit=500', undefined, { silent: true }),
        apiFetch('/api/v1/contact-events?limit=16', undefined, { silent: true }),
      ]);
      setActivitySummary(Array.isArray(summaryRows) ? summaryRows : []);
      setTimelineEvents(Array.isArray(eventRows) ? eventRows : []);
    } finally {
      setActivityLoading(false);
    }
  }, []);


  const closeModal = useCallback(() => setModalOpen(false), []);

  useEffect(() => {
    if (!customerEditRequest) return;
    const target = customers.find(c => String(c.id) === String(customerEditRequest));
    if (target) { setModalCustomer(target); setModalOpen(true); }
    setCustomerEditRequest(null);
  }, [customerEditRequest, customers, setCustomerEditRequest]);

  useEffect(() => {
    loadActivityData();
  }, [loadActivityData, customers.length]);

  const handleSave = async data => {
    setRequestError("");
    try {
      if (modalCustomer) {
        const updated = { ...modalCustomer, ...data };
        const res = await apiFetch(`/api/v1/customers/${modalCustomer.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        setCustomers(p => p.map(c => c.id === modalCustomer.id ? (res || updated) : c));
      } else {
        const body = { ...data };
        const res = await apiFetch('/api/v1/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        setCustomers(p => [...p, res || { id: uid(), ...body }]);
      }
      loadActivityData();
      closeModal();
    } catch (err) { setRequestError(err?.message || "Failed to save customer."); }
  };

  const deleteCustomer = async id => {
    if (!window.confirm("Delete this customer? This cannot be undone.")) return;
    setRequestError("");
    try {
      await apiFetch(`/api/v1/customers/${id}`, { method: 'DELETE' });
      setCustomers(p => p.filter(c => c.id !== id));
      loadActivityData();
    } catch (err) { setRequestError(err?.message || "Failed to delete customer."); }
  };

  return (
    <div>
      <div className="title-row">
        <div><div className="pill">Database Module</div><h2>Customer Directory</h2><div className="sub">Manage client profiles, locations, and communication history.</div></div>
        <div className="flex-row"><input type="search" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search name, phone, status, address..." style={{ width: '280px' }} /><button className="btn btn-accent" onClick={() => { setModalCustomer(null); setModalOpen(true); }}>+ New Customer</button></div>
      </div>
      {requestError && <div className="alert">{requestError}</div>}
      <div className="card customer-table-card" style={{ overflowX: 'auto' }}>
        {isInitialLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>Loading customersâ€¦</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>{searchTerm ? `No customers match "${searchTerm}".` : <>No customers yet. Click <strong style={{ color: 'var(--accent)' }}>+ New Customer</strong> to add one.</>}</div>
        ) : (
          <table className="customer-table">
            <thead><tr><th scope="col">Cust #</th><th scope="col">Name / Company</th><th scope="col">Address</th><th scope="col">Phone</th><th scope="col">Status</th><th scope="col">Activity</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {filtered.map(c => {
                const routeAddress = buildCustomerRouteAddress(c);
                const phoneLinkValue = buildPhoneLinkValue(c.phone);
                const activity = activitySummaryByCustomer.get(String(c.id));
                return (
                  <tr key={c.id}>
                    <td className="mono" data-label="Cust #" style={{ color: 'var(--accent)', fontWeight: 600 }}>#{String(c.customerNumber ?? '?').padStart(4, '0')}</td>
                    <td data-label="Name / Company" style={{ fontWeight: 600 }}>{c.markerEmoji && <span style={{ marginRight: 6 }}>{c.markerEmoji}</span>}{c.name}{c.notes && <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginTop: 2 }}>{c.notes}</div>}</td>
                    <td data-label="Address">
                      {routeAddress ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: '13px', lineHeight: '1.4' }}>
                            <div>{c.address}</div>
                            {c.cityStateZip && <div className="small" style={{ marginTop: 2 }}>{c.cityStateZip}</div>}
                          </div>
                          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(routeAddress)}`} target="_blank" rel="noopener noreferrer" className="badge" style={{ color: 'var(--accent)', textDecoration: 'none', background: 'rgba(110,168,254,0.1)', border: '1px solid rgba(110,168,254,0.2)', fontSize: '11px', marginTop: '2px' }} onClick={() => logContactEvent({ customerId: c.id, channel: 'manual', direction: 'system', eventType: 'navigation_started', subject: `Started navigation for ${c.name}`, bodySummary: routeAddress })}>
                            Navigate
                          </a>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>â€”</span>
                      )}
                    </td>
                    <td data-label="Phone">
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {phoneLinkValue ? (
                          <>
                            <span className="mono" style={{ fontSize: '12px', color: 'var(--muted)' }}>{c.phone}</span>
                            <a href={`tel:${phoneLinkValue}`} className="badge badge-good" title="Call Customer" style={{ textDecoration: 'none', padding: '4px 8px', fontSize: '12px' }} onClick={() => logContactEvent({ customerId: c.id, channel: 'phone', direction: 'outbound', eventType: 'call_opened', subject: `Opened call for ${c.name}`, bodySummary: c.phone || '' })}>
                              Call
                            </a>
                            <a href={`sms:${phoneLinkValue}`} className="badge badge-scheduled" title="Text Customer" style={{ textDecoration: 'none', padding: '4px 8px', fontSize: '12px' }} onClick={() => logContactEvent({ customerId: c.id, channel: 'sms', direction: 'outbound', eventType: 'sms_opened', subject: `Opened SMS composer for ${c.name}`, bodySummary: c.phone || '' })}>
                              Text
                            </a>
                          </>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>No Phone</span>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} className="badge" title="Email Customer" style={{ textDecoration: 'none', padding: '4px 8px', fontSize: '12px', background: 'var(--panel-soft)', border: '1px solid var(--border)' }} onClick={() => logContactEvent({ customerId: c.id, channel: 'email', direction: 'outbound', eventType: 'email_opened', subject: `Opened email composer for ${c.name}`, bodySummary: c.email })}>
                            Email
                          </a>
                        )}
                      </div>
                    </td>
                    <td data-label="Status"><span className={`badge ${c.status === 'Active' ? 'badge-good' : c.status === 'Inactive' ? '' : 'badge-warn'}`}>{c.status}</span></td>
                    <td className="customer-activity-cell" data-label="Activity">
                      {activityLoading ? (
                        <div className="small" style={{ color: 'var(--muted)' }}>Loading...</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 4 }}>
                          <div className="small" style={{ color: 'var(--muted)' }}>
                            Last: {activity?.lastContact ? `${formatLedgerEventTypeLabel(activity.lastContact.eventType)} Â· ${formatLedgerTimestamp(activity.lastContact.occurredAt)}` : 'No contact history'}
                          </div>
                          <div className="small" style={{ color: activity?.nextFollowup ? 'var(--warn)' : 'var(--muted)' }}>
                            Next: {activity?.nextFollowup ? `${formatLedgerDate(activity.nextFollowup.dueAt)} Â· ${activity.nextFollowup.subject || 'Follow-up'}` : 'None scheduled'}
                          </div>
                          {activity?.openFollowupCount > 0 && <span className="badge badge-warn" style={{ width: 'fit-content' }}>{activity.openFollowupCount} open</span>}
                        </div>
                      )}
                    </td>
                    <td className="customer-actions-cell" data-label="Actions">
                      <div className="customer-actions-group">
                        <button className="btn btn-sm" onClick={() => { setModalCustomer(c); setModalOpen(true); }}>Edit</button>
                        <button className="btn btn-sm" onClick={() => setCommunicationsCustomer(c)}>Comms</button>
                        <button className="btn btn-sm" onClick={() => { setCustomerJobsRequest && setCustomerJobsRequest(c.id); setActiveTab('jobs'); }}>Recurring Jobs</button>
                        <button className="btn btn-sm" onClick={() => { setMapFocus({ name: c.name, address: c.address, markerEmoji: c.markerEmoji || '' }); setActiveTab('map'); }} disabled={!c.address}>Map</button>
                        {canExecuteDelete
                          ? <button className="btn btn-sm btn-danger" onClick={() => deleteCustomer(c.id)}>Delete</button>
                          : <button className="btn btn-sm btn-danger" onClick={() => onRequestDelete('customer', c.id, c.name)}>Request Delete</button>
                        }
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Customer Activity Timeline</h3>
            <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>Latest calls, texts, email opens, invoice actions, recurring occurrence pushes, and follow-up scheduling.</div>
          </div>
          <button className="btn btn-sm" onClick={loadActivityData}>Refresh</button>
        </div>
        {activityLoading ? (
          <div className="small" style={{ color: 'var(--muted)' }}>Loading customer activity...</div>
        ) : timelineEvents.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '28px 20px', background: 'var(--panel-soft)', borderRadius: 8 }}>
            No customer communication events are recorded yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {timelineEvents.map(event => (
              <div key={event.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge" style={contactChannelStyles(event.channel)}>{event.channel || 'manual'}</span>
                    <span className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{event.direction || 'system'}</span>
                    <span style={{ fontWeight: 700 }}>{event.customerName || 'Customer'}</span>
                    {event.jobNumber ? <span className="small" style={{ color: 'var(--muted)' }}>Job #{event.jobNumber}</span> : null}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 8 }}>{event.subject || formatLedgerEventTypeLabel(event.eventType)}</div>
                  <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>{formatLedgerEventTypeLabel(event.eventType)}</div>
                  {event.bodySummary && <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{event.bodySummary}</div>}
                </div>
                <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
                  <div className="small" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatLedgerTimestamp(event.occurredAt)}</div>
                  {event.customerId && <button className="btn btn-sm" onClick={() => openCommunicationsLedger(event.customerId)}>Open Ledger</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {modalOpen && <CustomerModal customer={modalCustomer} onSave={handleSave} onClose={closeModal} />}
      {communicationsCustomer && <CustomerCommunicationsModal customer={communicationsCustomer} onClose={() => setCommunicationsCustomer(null)} onUpdated={loadActivityData} />}
    </div>
  );
}

// â”€â”€â”€ JOBS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function JobsMetricCard({ title, value, tone = 'var(--text)' }) {
  const accentColor = tone === 'var(--text)' ? 'var(--accent)' : tone;
  return (
    <div className="card span-3" style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 112,
      borderLeft: `3px solid ${accentColor}`, paddingLeft: 18,
    }}>
      <div style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 700 }}>{title}</div>
      <div className="mono" style={{ fontSize: 30, fontWeight: 800, color: tone, marginTop: 6, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function JobsStatusBadge({ job }) {
  const label = getJobDisplayStatusLabel(job);
  const inactive = isJobInactiveDisplay(job);
  return (
    <span
      className={`badge ${inactive ? '' : jobStatusClass(job.status)}`}
      style={inactive ? { background: 'rgba(170, 180, 212, 0.16)', color: 'var(--muted)', border: '1px solid rgba(170, 180, 212, 0.28)' } : undefined}
    >
      {label}
    </span>
  );
}

function JobsDropdownItem({ label, onClick, danger = false }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 14px',
        background: hov ? (danger ? 'rgba(255,107,107,0.10)' : 'rgba(110,168,254,0.08)') : 'transparent',
        border: 'none',
        color: danger ? 'var(--danger)' : (hov ? 'var(--text)' : 'var(--muted)'),
        cursor: 'pointer',
        fontSize: 13,
        transition: 'background 0.1s, color 0.1s',
      }}
    >
      {label}
    </button>
  );
}

function JobsTab({ serviceJobs, setServiceJobs, customers, employees, calAuth, canExecuteDelete = true, onRequestDelete = () => { } }) {
  const [modalJob, setModalJob] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [hoveredJobId, setHoveredJobId] = useState(null);
  const [activeDropdownId, setActiveDropdownId] = useState(null);
  const [actionNotice, setActionNotice] = useState("");
  const [actionNoticeTone, setActionNoticeTone] = useState("success");
  const [addressModalJob, setAddressModalJob] = useState(null);
  const [addressDraft, setAddressDraft] = useState(createJobAddressDraft());
  const [recentJobEvents, setRecentJobEvents] = useState([]);
  const [jobEventsLoading, setJobEventsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const closeModal = useCallback(() => setModalOpen(false), []);
  const closeAddressModal = useCallback(() => {
    setAddressModalJob(null);
    setAddressDraft(createJobAddressDraft());
  }, []);

  useEffect(() => {
    if (!activeDropdownId) return;
    const handler = () => setActiveDropdownId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [activeDropdownId]);

  useEffect(() => {
    if (!actionNotice) return;
    const timeoutId = window.setTimeout(() => setActionNotice(""), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [actionNotice]);

  const showActionNotice = useCallback((message, tone = "success") => {
    setActionNoticeTone(tone);
    setActionNotice(message);
  }, []);

  const buildJobUpdateNotice = useCallback((savedJob, successMessage) => {
    if (savedJob?.calendarSyncStatus === 'updated') {
      return { tone: 'success', message: `${successMessage} Google Calendar updated.` };
    }
    if (savedJob?.calendarSyncStatus === 'failed') {
      return { tone: 'warning', message: String(savedJob?.calendarSyncWarning || `${successMessage} Google Calendar update failed.`).trim() };
    }
    return { tone: 'success', message: successMessage };
  }, []);

  const loadRecentJobEvents = useCallback(async () => {
    setJobEventsLoading(true);
    try {
      const rows = await apiFetch('/api/v1/contact-events?has_job=1&limit=10', undefined, { silent: true });
      setRecentJobEvents(Array.isArray(rows) ? rows : []);
    } finally {
      setJobEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentJobEvents();
  }, [loadRecentJobEvents]);

  const recordLocalJobEvent = useCallback((job, customer, payload) => {
    if (!payload?.eventType) return;
    setRecentJobEvents(prev => ([
      {
        id: `local-${uid()}`,
        customerId: customer?.id || '',
        customerName: customer?.name || '',
        jobId: job?.id || '',
        jobNumber: job?.jobNumber || '',
        channel: payload.channel || 'manual',
        direction: payload.direction || 'system',
        eventType: payload.eventType,
        subject: payload.subject || '',
        bodySummary: payload.bodySummary || '',
        occurredAt: payload.occurredAt || new Date().toISOString(),
      },
      ...prev,
    ].slice(0, 10)));
  }, []);

  const openEdit = useCallback(job => { setModalJob(job); setModalOpen(true); setActiveDropdownId(null); }, []);
  const openAddressModal = useCallback(job => {
    setAddressModalJob(job);
    setAddressDraft(createJobAddressDraft(job?.address));
    setActiveDropdownId(null);
  }, []);

  const handleSave = async data => {
    setRequestError("");
    const preparedData = withJobFinancialDefaults(data);
    try {
      let savedJob = null;
      if (modalJob) {
        const updated = withJobFinancialDefaults({ ...modalJob, ...preparedData });
        const res = await apiFetch(`/api/v1/jobs/${modalJob.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        savedJob = withJobFinancialDefaults(res || updated);
        setServiceJobs(p => p.map(j => j.id === modalJob.id ? savedJob : j));
      } else {
        const res = await apiFetch('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preparedData) });
        savedJob = withJobFinancialDefaults(res || { id: uid(), jobNumber: Math.floor(Math.random() * 9000) + 1000, ...preparedData });
        setServiceJobs(p => [...p, savedJob]);
      }
      const notice = buildJobUpdateNotice(savedJob, `Job #${savedJob?.jobNumber || savedJob?.id || 'new'} saved.`);
      showActionNotice(notice.message, notice.tone);
      await loadRecentJobEvents();
      closeModal();
    } catch (err) { setRequestError(err?.message || "Failed to save job."); }
  };

  const deleteJob = async id => {
    if (!window.confirm("Delete this job? This cannot be undone.")) return;
    const targetJob = serviceJobs.find(job => String(job.id) === String(id));
    setRequestError("");
    setActiveDropdownId(null);
    try {
      await apiFetch(`/api/v1/jobs/${id}`, { method: 'DELETE' });
      setServiceJobs(p => p.filter(j => j.id !== id));
      showActionNotice(`Job #${targetJob?.jobNumber || id} deleted.`);
    } catch (err) { setRequestError(err?.message || "Failed to delete job."); }
  };

  const syncToCalendar = async job => {
    if (!calAuth || !job.scheduledDate) return;
    setRequestError("");
    setActiveDropdownId(null);
    const customerName = customers.find(c => String(c.id) === String(job.customerId))?.name || "";
    const summary = `${job.serviceType}${customerName ? ' â€“ ' + customerName : ''}`;
    try {
      const res = await apiFetch(`/api/v1/jobs/${job.id}/calendar-event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary, description: job.notes || '' }) });
      const updated = withJobFinancialDefaults({ ...job, gcalEventId: res?.gcalEventId || job.gcalEventId });
      setServiceJobs(p => p.map(j => j.id === job.id ? updated : j));
      showActionNotice(`Calendar synced for job #${job.jobNumber || job.id}.`);
      await loadRecentJobEvents();
    } catch (err) { setRequestError(err?.message || "Failed to sync to Google Calendar."); }
  };

  const quickCompleteJob = async job => {
    if (job.status === 'Completed') return;
    setRequestError("");
    const updated = withJobFinancialDefaults({ ...job, status: 'Completed' });
    try {
      const res = await apiFetch(`/api/v1/jobs/${job.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      const savedJob = withJobFinancialDefaults(res || updated);
      setServiceJobs(p => p.map(j => j.id === job.id ? savedJob : j));
      const notice = buildJobUpdateNotice(savedJob, `Job #${job.jobNumber || job.id} marked completed.`);
      showActionNotice(notice.message, notice.tone);
      await loadRecentJobEvents();
    } catch (err) { setRequestError(err?.message || 'Failed to mark job complete.'); }
  };

  const quickMarkPaid = async job => {
    setActiveDropdownId(null);
    setRequestError("");
    const updated = withJobFinancialDefaults({ ...job, paymentStatus: 'paid', invoiceSent: true });
    try {
      const res = await apiFetch(`/api/v1/jobs/${job.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      const savedJob = withJobFinancialDefaults(res || updated);
      setServiceJobs(p => p.map(j => j.id === job.id ? savedJob : j));
      const notice = buildJobUpdateNotice(savedJob, `Job #${job.jobNumber || job.id} marked paid and invoice sent.`);
      showActionNotice(notice.message, notice.tone);
      await loadRecentJobEvents();
    } catch (err) { setRequestError(err?.message || 'Failed to update payment status.'); }
  };

  const quickMarkInvoiceSent = async job => {
    setActiveDropdownId(null);
    setRequestError("");
    const updated = withJobFinancialDefaults({ ...job, invoiceSent: true });
    try {
      const res = await apiFetch(`/api/v1/jobs/${job.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      const savedJob = withJobFinancialDefaults(res || updated);
      setServiceJobs(p => p.map(j => j.id === job.id ? savedJob : j));
      const notice = buildJobUpdateNotice(savedJob, `Invoice flagged sent for job #${job.jobNumber || job.id}.`);
      showActionNotice(notice.message, notice.tone);
      await loadRecentJobEvents();
    } catch (err) { setRequestError(err?.message || 'Failed to flag invoice as sent.'); }
  };

  const generateJobInvoice = async job => {
    const customer = customers.find(c => String(c.id) === String(job.customerId)) || { name: getCustomerName(job.customerId) };
    setActiveDropdownId(null);
    setRequestError("");
    try {
      await generateReceiptPDF(buildJobReceiptPayload(job, customer));
      const eventPayload = {
        channel: 'invoice',
        direction: 'system',
        eventType: 'invoice_generated',
        subject: `Invoice PDF generated for ${customer.name || 'customer'}`,
        bodySummary: `Job #${job.jobNumber || job.id} | ${job.serviceType || 'Service job'} | ${money(Number(job.actualAmount) || Number(job.quotedAmount) || 0)}`,
      };
      if (customer?.id) {
        logContactEvent({ customerId: customer.id, jobId: job.id, ...eventPayload });
      }
      recordLocalJobEvent(job, customer, eventPayload);
      showActionNotice(`Invoice PDF generated for job #${job.jobNumber || job.id}.`);
    } catch (err) {
      setRequestError(err?.message || 'Failed to generate invoice PDF.');
    }
  };

  const saveAddressDraft = async () => {
    if (!addressModalJob) return;
    const address = composeJobAddressDraft(addressDraft);
    if (!address) {
      setRequestError("Enter an address before saving.");
      return;
    }
    setRequestError("");
    const updated = withJobFinancialDefaults({ ...addressModalJob, address });
    try {
      const res = await apiFetch(`/api/v1/jobs/${addressModalJob.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      const savedJob = withJobFinancialDefaults(res || updated);
      setServiceJobs(p => p.map(j => j.id === addressModalJob.id ? savedJob : j));
      const notice = buildJobUpdateNotice(savedJob, `Address updated for job #${addressModalJob.jobNumber || addressModalJob.id}.`);
      showActionNotice(notice.message, notice.tone);
      await loadRecentJobEvents();
      closeAddressModal();
    } catch (err) { setRequestError(err?.message || 'Failed to save address.'); }
  };

  const openMessageCustomer = job => {
    const customer = customers.find(c => String(c.id) === String(job.customerId));
    const phoneValue = buildPhoneLinkValue(customer?.phone);
    setActiveDropdownId(null);
    if (phoneValue) {
      if (customer?.id) {
        const eventPayload = {
          channel: 'sms',
          direction: 'outbound',
          eventType: 'sms_opened',
          subject: `Opened SMS composer for ${customer.name || 'customer'}`,
          bodySummary: `Job #${job.jobNumber || job.id} | ${job.serviceType || ''}`.trim(),
        };
        logContactEvent({ customerId: customer.id, jobId: job.id, ...eventPayload });
        recordLocalJobEvent(job, customer, eventPayload);
      }
      window.location.href = `sms:${phoneValue}`;
      return;
    }
    setRequestError("This customer has no phone number on file.");
  };

  const openEmailCustomer = job => {
    const customer = customers.find(c => String(c.id) === String(job.customerId));
    const emailValue = String(customer?.email || "").trim();
    setActiveDropdownId(null);
    if (emailValue) {
      if (customer?.id) {
        const eventPayload = {
          channel: 'email',
          direction: 'outbound',
          eventType: 'email_opened',
          subject: `Opened email composer for ${customer.name || 'customer'}`,
          bodySummary: `Job #${job.jobNumber || job.id} | ${emailValue}`,
        };
        logContactEvent({ customerId: customer.id, jobId: job.id, ...eventPayload });
        recordLocalJobEvent(job, customer, eventPayload);
      }
      window.location.href = `mailto:${emailValue}`;
      return;
    }
    setRequestError("This customer has no email on file.");
  };

  const customerById = useMemo(() => {
    const map = new Map();
    (customers || []).forEach(c => map.set(String(c.id), c));
    return map;
  }, [customers]);

  const employeeById = useMemo(() => {
    const map = new Map();
    (employees || []).forEach(e => map.set(String(e.id), e));
    return map;
  }, [employees]);

  const getCustomerName = useCallback(id => {
    return customerById.get(String(id))?.name || "â€”";
  }, [customerById]);

  const getAssignedNames = useCallback(ids => {
    if (!Array.isArray(ids) || ids.length === 0) return null;
    return ids.map(id => employeeById.get(String(id))?.name).filter(Boolean).join(", ") || null;
  }, [employeeById]);

  const activeEmployeeIds = useMemo(() => new Set(employees.filter(e => e.active).map(e => String(e.id))), [employees]);
  const totalRevenue = serviceJobs.filter(j => j.status === "Completed").reduce((s, j) => s + (Number(j.actualAmount) || 0), 0);
  const totalOverhead = serviceJobs.filter(j => j.status === "Completed").reduce((s, j) => s + (Number(j.overheadSpent) || 0), 0);

  const filteredJobs = useMemo(() => {
    const term = String(searchTerm || "").trim().toLowerCase();
    if (!term) return serviceJobs;
    return (serviceJobs || []).filter(job => {
      const customerName = customerById.get(String(job.customerId))?.name || "";
      const assignedNames = Array.isArray(job.assignedEmployeeIds)
        ? job.assignedEmployeeIds.map(id => employeeById.get(String(id))?.name).filter(Boolean).join(" ")
        : "";
      const haystack = [
        job.jobNumber, customerName, job.serviceType, job.address,
        job.status, getJobDisplayStatusLabel(job), getJobPaymentStatus(job),
        job.scheduledDate, job.notes, assignedNames,
        job.quotedAmount, job.actualAmount, job.overheadSpent,
        getJobRecurrenceSummary(job),
      ].filter(v => v !== null && v !== undefined).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [searchTerm, serviceJobs, customerById, employeeById]);

  const EditBtn = ({ onClick, visible = false }) => {
    const [hov, setHov] = useState(false);
    return (
      <button type="button" onClick={e => { e.stopPropagation(); onClick(); }}
        onMouseEnter={() => visible && setHov(true)}
        onMouseLeave={() => setHov(false)}
        tabIndex={visible ? 0 : -1}
        aria-hidden={!visible}
        style={{
          flexShrink: 0, border: 'none', cursor: visible ? 'pointer' : 'default', padding: '2px 6px', borderRadius: 4,
          minWidth: 24,
          fontSize: 13, lineHeight: 1,
          background: visible && hov ? 'rgba(110,168,254,0.16)' : 'transparent',
          color: hov ? 'var(--text)' : 'var(--accent)',
          opacity: visible ? 1 : 0,
          visibility: visible ? 'visible' : 'hidden',
          pointerEvents: visible ? 'auto' : 'none',
          transition: 'background 0.1s, color 0.1s, opacity 0.1s',
        }}
        title="Edit">âœŽ</button>
    );
  };

  const ddSection = { padding: '8px 14px 5px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderTop: '1px solid var(--border)', marginTop: 4 };
  const cellRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 };

  return (
    <div>
      <div className="title-row">
        <div><div className="pill">Jobs Module</div><h2>Service Jobs</h2><div className="sub">Source of truth for revenue, overhead, and scheduling.</div></div>
        <button className="btn btn-accent" onClick={() => { setModalJob(null); setModalOpen(true); }}>+ New Job</button>
      </div>
      {requestError && <div className="alert">{requestError}</div>}
      {actionNotice && (
        <div className="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(actionNoticeTone === 'warning' ? { borderColor: 'rgba(255, 179, 71, 0.35)', color: 'var(--warn)' } : { borderColor: 'rgba(64, 192, 87, 0.35)', color: 'var(--good)' }) }}>
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice("")} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: 16, lineHeight: 1, padding: '0 0 0 12px' }}>âœ•</button>
        </div>
      )}
      <div className="grid" style={{ marginTop: 0, marginBottom: 18 }}>
        <JobsMetricCard title="Total Jobs" value={serviceJobs.length} />
        <JobsMetricCard title="Completed" value={serviceJobs.filter(j => j.status === "Completed").length} tone="var(--good)" />
        <JobsMetricCard title="Revenue (Completed)" value={money(totalRevenue)} tone="var(--good)" />
        <JobsMetricCard title="Overhead (Completed)" value={money(totalOverhead)} tone="var(--danger)" />
      </div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px' }}>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search jobs, customer, service, address, status, employee, date..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', fontSize: 14 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {searchTerm.trim() && (
              <button className="btn btn-sm" onClick={() => setSearchTerm("")}>Clear</button>
            )}
            <div className="small" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              Showing {filteredJobs.length} of {serviceJobs.length}
            </div>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Recent Communication & Billing Events</h3>
            <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>Job-linked completion, payment, invoice, calendar, email, text, and navigation events.</div>
          </div>
          <button className="btn btn-sm" onClick={loadRecentJobEvents}>Refresh</button>
        </div>
        {jobEventsLoading ? (
          <div className="small" style={{ color: 'var(--muted)' }}>Loading job event history...</div>
        ) : recentJobEvents.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '28px 20px', background: 'var(--panel-soft)', borderRadius: 8 }}>
            No job-linked communication or billing events recorded yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {recentJobEvents.map(event => (
              <div key={event.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-soft)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge" style={contactChannelStyles(event.channel)}>{event.channel || 'manual'}</span>
                    <span className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{event.direction || 'system'}</span>
                    <span style={{ fontWeight: 700 }}>{event.customerName || getCustomerName(event.customerId) || 'Customer'}</span>
                    {event.jobNumber ? <span className="small" style={{ color: 'var(--muted)' }}>Job #{event.jobNumber}</span> : null}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 8 }}>{event.subject || formatLedgerEventTypeLabel(event.eventType)}</div>
                  <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>{formatLedgerEventTypeLabel(event.eventType)}</div>
                  {event.bodySummary && <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{event.bodySummary}</div>}
                </div>
                <div className="small" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatLedgerTimestamp(event.occurredAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        {serviceJobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>No jobs yet. Click <strong style={{ color: 'var(--accent)' }}>+ New Job</strong> to add one.</div>
        ) : filteredJobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>No jobs match the current search.</div>
        ) : (
          <div style={{ overflowX: activeDropdownId ? 'visible' : 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Customer</th><th>Service</th><th>Address</th>
                  <th>Status</th><th>Financials</th><th>Date</th>
                  <th>Quoted / Actual</th><th>Overhead</th><th>Assigned</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map(job => {
                  const isHovered = hoveredJobId === job.id;
                  const isDropdownOpen = activeDropdownId === job.id;
                  const hasActiveAssignees = Array.isArray(job.assignedEmployeeIds) && job.assignedEmployeeIds.some(id => activeEmployeeIds.has(String(id)));
                  const showPayrollWarning = job.status === "Completed" && !hasActiveAssignees;
                  const paymentStatus = getJobPaymentStatus(job);
                  const invoiceSent = isJobInvoiceSent(job);
                  const assignedNames = getAssignedNames(job.assignedEmployeeIds);
                  return (
                    <tr key={job.id}
                      onMouseEnter={() => setHoveredJobId(job.id)}
                      onMouseLeave={() => setHoveredJobId(null)}
                      style={isHovered ? { background: 'rgba(110,168,254,0.04)', outline: '1px solid rgba(110,168,254,0.10)' } : undefined}
                    >
                      {/* # */}
                      <td className="mono" style={{ color: 'var(--muted)' }}>#{job.jobNumber}</td>

                      {/* Customer */}
                      <td>
                        <div style={cellRow}>
                          <span style={{ fontWeight: 600 }}>{getCustomerName(job.customerId)}</span>
                          <EditBtn visible={isHovered} onClick={() => openEdit(job)} />
                        </div>
                      </td>

                      {/* Service */}
                      <td>
                        <div style={cellRow}>
                          <div>
                            <div>{job.serviceType}</div>
                            {getJobRecurrenceSummary(job) && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{getJobRecurrenceSummary(job)}</div>}
                          </div>
                          <EditBtn visible={isHovered} onClick={() => openEdit(job)} />
                        </div>
                      </td>

                      {/* Address */}
                      <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                        <div style={cellRow}>
                          <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.address}>{job.address || 'â€”'}</span>
                          <EditBtn visible={isHovered} onClick={() => openEdit(job)} />
                        </div>
                      </td>

                      {/* Status â€” uses JobsStatusBadge for inactivity label */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => openEdit(job)}>
                          <JobsStatusBadge job={job} />
                        </div>
                      </td>

                      {/* Financials */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }} onClick={() => openEdit(job)}>
                          <span className={`badge ${jobPaymentStatusClass(paymentStatus)}`}>{paymentStatus}</span>
                          {job.status === "Completed" && paymentStatus !== "Paid" && (
                            <span style={{ fontSize: 10, color: invoiceSent ? 'var(--good)' : 'var(--danger)', fontWeight: 600 }}>
                              {invoiceSent ? 'INVOICED' : 'NO INVOICE'}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        <div style={cellRow}>
                          <span>{job.scheduledDate || 'â€”'}</span>
                          <EditBtn visible={isHovered} onClick={() => openEdit(job)} />
                        </div>
                      </td>

                      {/* Quoted / Actual */}
                      <td className="mono">
                        <div style={cellRow}>
                          <span>
                            {job.quotedAmount ? money(job.quotedAmount) : 'â€”'}
                            <span style={{ margin: '0 4px', color: 'var(--muted)' }}>/</span>
                            {job.actualAmount ? money(job.actualAmount) : 'â€”'}
                          </span>
                          <EditBtn visible={isHovered} onClick={() => openEdit(job)} />
                        </div>
                      </td>

                      {/* Overhead */}
                      <td className="mono">
                        <div style={cellRow}>
                          <span style={{ color: job.overheadSpent ? 'var(--danger)' : 'var(--muted)' }}>{job.overheadSpent ? money(job.overheadSpent) : 'â€”'}</span>
                          <EditBtn visible={isHovered} onClick={() => openEdit(job)} />
                        </div>
                      </td>

                      {/* Assigned */}
                      <td style={{ fontSize: 13 }}>
                        {assignedNames ? (
                          <div style={cellRow}>
                            <div>
                              <div>{assignedNames}</div>
                              {showPayrollWarning && <div style={{ marginTop: 4 }}><span className="badge badge-warn">No Active Assignees</span></div>}
                            </div>
                            <EditBtn visible={isHovered} onClick={() => openEdit(job)} />
                          </div>
                        ) : (
                          <button type="button" onClick={() => openEdit(job)}
                            style={{
                              fontSize: 12, padding: '3px 10px',
                              background: isHovered ? 'rgba(110,168,254,0.15)' : 'transparent',
                              border: '1px solid var(--accent)', borderRadius: 12,
                              color: 'var(--accent)', cursor: 'pointer',
                              transition: 'background 0.1s',
                            }}>
                            + Assign
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>

                          {/* Primary action strip â€” one obvious next step per state */}
                          {job.status !== 'Completed' && (
                            <button type="button" title="Mark Completed" onClick={() => quickCompleteJob(job)}
                              style={{ padding: '5px 10px', fontSize: 13, fontWeight: 600, background: 'rgba(64,192,87,0.1)', border: '1px solid rgba(64,192,87,0.3)', borderRadius: 6, cursor: 'pointer', color: 'var(--good)', transition: 'background 0.15s' }}>
                              âœ“ Done
                            </button>
                          )}
                          {job.status === 'Completed' && !invoiceSent && paymentStatus !== 'Paid' && (
                            <>
                              <button type="button" title="Generate Invoice" onClick={() => generateJobInvoice(job)}
                                style={{ padding: '5px 10px', fontSize: 13, fontWeight: 600, background: 'rgba(110,168,254,0.1)', border: '1px solid rgba(110,168,254,0.3)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent)', transition: 'background 0.15s' }}>
                                ðŸ“‹ Invoice
                              </button>
                              <button type="button" title="Mark Invoice Sent" onClick={() => quickMarkInvoiceSent(job)}
                                style={{ padding: '5px 10px', fontSize: 13, fontWeight: 600, background: 'rgba(110,168,254,0.08)', border: '1px solid rgba(110,168,254,0.25)', borderRadius: 6, cursor: 'pointer', color: 'var(--accent)', transition: 'background 0.15s' }}>
                                âœ‰ Sent
                              </button>
                              <button type="button" title="Mark Paid" onClick={() => quickMarkPaid(job)}
                                style={{ padding: '5px 10px', fontSize: 13, fontWeight: 600, background: 'rgba(64,192,87,0.1)', border: '1px solid rgba(64,192,87,0.3)', borderRadius: 6, cursor: 'pointer', color: 'var(--good)', transition: 'background 0.15s' }}>
                                $ Paid
                              </button>
                            </>
                          )}
                          {job.status === 'Completed' && invoiceSent && paymentStatus !== 'Paid' && (
                            <button type="button" title="Mark Paid" onClick={() => quickMarkPaid(job)}
                              style={{ padding: '5px 10px', fontSize: 13, fontWeight: 600, background: 'rgba(64,192,87,0.1)', border: '1px solid rgba(64,192,87,0.3)', borderRadius: 6, cursor: 'pointer', color: 'var(--good)', transition: 'background 0.15s' }}>
                              $ Paid
                            </button>
                          )}

                          {/* Delete / Request Delete */}
                          <button type="button"
                            title={canExecuteDelete ? 'Delete Job' : 'Request Deletion'}
                            onClick={() => canExecuteDelete ? deleteJob(job.id) : onRequestDelete('job', job.id, `Job #${job.jobNumber || job.id}`)}
                            style={{
                              background: isHovered ? 'rgba(255,107,107,0.10)' : 'transparent',
                              border: '1px solid transparent', borderRadius: 6, cursor: 'pointer',
                              padding: '4px 7px', fontSize: 15, color: 'var(--danger)',
                              opacity: isHovered ? 1 : 0.18,
                              transition: 'opacity 0.15s, background 0.15s',
                            }}>ðŸ—‘</button>

                          {/* Dropdown â€” secondary/admin actions only */}
                          <div style={{ position: 'relative' }}>
                            <button type="button" title="More actions"
                              onClick={e => { e.stopPropagation(); setActiveDropdownId(isDropdownOpen ? null : job.id); }}
                              style={{
                                padding: '4px 10px', fontWeight: 700, letterSpacing: '0.08em', fontSize: 15,
                                background: isDropdownOpen ? 'rgba(110,168,254,0.15)' : (isHovered ? 'rgba(255,255,255,0.05)' : 'transparent'),
                                border: `1px solid ${isDropdownOpen ? 'rgba(110,168,254,0.5)' : 'var(--border)'}`,
                                borderRadius: 6, cursor: 'pointer', lineHeight: 1,
                                color: isDropdownOpen ? 'var(--accent)' : 'var(--muted)',
                                transition: 'background 0.1s, border-color 0.1s, color 0.1s',
                              }}>â‹¯</button>

                            {isDropdownOpen && (
                              <div onClick={e => e.stopPropagation()}
                                style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', minWidth: 210, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, zIndex: 100, boxShadow: '0 12px 32px rgba(0,0,0,0.45)', overflow: 'hidden' }}>

                                <div style={{ padding: '8px 14px 5px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Workflow</div>
                                <JobsDropdownItem label="Edit Address" onClick={() => openAddressModal(job)} />
                                <JobsDropdownItem label="âœŽ  Edit Details" onClick={() => openEdit(job)} />
                                {job.address && (
                                  <JobsDropdownItem label="ðŸ—º  Open in Maps" onClick={() => {
                                    const customer = customers.find(c => String(c.id) === String(job.customerId));
                                    const eventPayload = {
                                      channel: 'manual',
                                      direction: 'system',
                                      eventType: 'navigation_started',
                                      subject: `Started navigation for ${customer?.name || 'customer'}`,
                                      bodySummary: job.address,
                                    };
                                    if (customer?.id) {
                                      logContactEvent({ customerId: customer.id, jobId: job.id, ...eventPayload });
                                    }
                                    recordLocalJobEvent(job, customer, eventPayload);
                                    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`, '_blank');
                                    setActiveDropdownId(null);
                                  }} />
                                )}
                                <JobsDropdownItem label="Message Customer" onClick={() => openMessageCustomer(job)} />
                                <JobsDropdownItem label="Email Customer" onClick={() => openEmailCustomer(job)} />
                                <div style={ddSection}>Financials</div>
                                <JobsDropdownItem label="âœŽ  Update Quoted / Actual" onClick={() => openEdit(job)} />
                                <JobsDropdownItem label="âœŽ  Update Overhead" onClick={() => openEdit(job)} />
                                <div style={ddSection}>Management</div>
                                {calAuth && job.scheduledDate && (
                                  job.gcalEventId
                                    ? <JobsDropdownItem label="ðŸ“… Synced to Calendar" onClick={() => setActiveDropdownId(null)} />
                                    : <JobsDropdownItem label="ðŸ“… Sync to Calendar" onClick={() => syncToCalendar(job)} />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modalOpen && <JobModal job={modalJob} customers={customers} employees={employees} onSave={handleSave} onClose={closeModal} />}
      {addressModalJob && (
        <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) closeAddressModal(); }}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>Edit Address</h3>
              <button className="modal-close" onClick={closeAddressModal}>&times;</button>
            </div>
            <div className="modal-field">
              <label>Street Address</label>
              <input value={addressDraft.street} onChange={event => setAddressDraft(prev => ({ ...prev, street: event.target.value }))} placeholder="100 Demo Way" />
            </div>
            <div className="modal-field">
              <label>Apartment / Suite / Unit #</label>
              <input value={addressDraft.unit} onChange={event => setAddressDraft(prev => ({ ...prev, unit: event.target.value }))} placeholder="Apt 4B" />
            </div>
            <div className="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 0 }}>
              <div className="modal-field">
                <label>City</label>
                <input value={addressDraft.city} onChange={event => setAddressDraft(prev => ({ ...prev, city: event.target.value }))} placeholder="Racine" />
              </div>
              <div className="modal-field">
                <label>State</label>
                <input value={addressDraft.state} onChange={event => setAddressDraft(prev => ({ ...prev, state: event.target.value }))} placeholder="WI" />
              </div>
              <div className="modal-field">
                <label>Area / Zip Code</label>
                <input value={addressDraft.zip} onChange={event => setAddressDraft(prev => ({ ...prev, zip: event.target.value }))} placeholder="53132" />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={closeAddressModal}>Cancel</button>
              <button className="btn btn-accent btn-sm" onClick={saveAddressDraft}>Save Address</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ CUSTOMER JOBS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CustomerJobsTab({ customers = [], apiFetch: recurringApiFetch, onJobAction = () => { }, customerJobsRequest = null, setCustomerJobsRequest = null, canExecuteDelete = true, onRequestDelete = () => { }, refreshSignal = 0 }) {
  const [view, setView] = useState('customers');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [occurrences, setOccurrences] = useState([]);
  const [jobFormData, setJobFormData] = useState(createRecurringJobDraft());
  const [jobPlanRows, setJobPlanRows] = useState([createRecurringJobDraft()]);
  const [sharedSnapshot, setSharedSnapshot] = useState(createRecurringSnapshot());
  const [pushFormData, setPushFormData] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, week_slot: 1 });
  const [showPushModal, setShowPushModal] = useState(null);
  const [error, setError] = useState('');
  const runApiFetch = recurringApiFetch || apiFetch;

  const normalizedCustomers = useMemo(
    () => customers.map(buildRecurringCustomerPacket).filter(customer => customer.id && customer.name),
    [customers]
  );

  const cloneSnapshot = snapshot => ({
    name: String(snapshot?.name ?? ''),
    phone: String(snapshot?.phone ?? ''),
    email: String(snapshot?.email ?? ''),
    street: String(snapshot?.street ?? ''),
    city: String(snapshot?.city ?? ''),
    state: String(snapshot?.state ?? ''),
    zip: String(snapshot?.zip ?? ''),
  });

  const normalizeDraftState = draft => {
    const normalized = createRecurringJobDraft(draft);
    if (normalized.schedule_mode === 'specific' && normalized.selected_months.length > 0 && !normalized.selected_months.includes(Number(normalized.start_month))) {
      normalized.start_month = normalized.selected_months[0];
    }
    return normalized;
  };

  useEffect(() => {
    if (!selectedCustomer) return;
    const next = normalizedCustomers.find(customer => customer.id === selectedCustomer.id);
    if (!next) return;
    if (
      next.name !== selectedCustomer.name ||
      next.phone !== selectedCustomer.phone ||
      next.email !== selectedCustomer.email ||
      next.street !== selectedCustomer.street ||
      next.city !== selectedCustomer.city ||
      next.state !== selectedCustomer.state ||
      next.zip !== selectedCustomer.zip
    ) {
      setSelectedCustomer(next);
    }
  }, [normalizedCustomers, selectedCustomer]);

  const loadJobs = async customerId => {
    try {
      setError('');
      const data = await runApiFetch(`/api/v1/customers/${customerId}/jobs`, { method: 'GET' });
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setJobs([]);
      setError(err?.message || 'Failed to load recurring jobs.');
    }
  };

  const loadOccurrences = async jobId => {
    try {
      setError('');
      const data = await runApiFetch(`/api/v1/customer-jobs/${jobId}/occurrences`, { method: 'GET' });
      setOccurrences(Array.isArray(data) ? data : []);
    } catch (err) {
      setOccurrences([]);
      setError(err?.message || 'Failed to load job occurrences.');
    }
  };

  const openCustomerJobs = async customer => {
    setSelectedCustomer(customer);
    setSelectedJob(null);
    setOccurrences([]);
    await loadJobs(customer.id);
    setView('jobs');
  };

  useEffect(() => {
    if (!customerJobsRequest) return;
    const target = normalizedCustomers.find(customer => String(customer.id) === String(customerJobsRequest));
    if (!target) return;
    let cancelled = false;
    (async () => {
      await openCustomerJobs(target);
      if (!cancelled && setCustomerJobsRequest) setCustomerJobsRequest(null);
    })();
    return () => { cancelled = true; };
  }, [customerJobsRequest, normalizedCustomers, setCustomerJobsRequest]);

  // Re-fetch if a parent signals a refresh (e.g. after admin executes a recurring-job delete)
  useEffect(() => {
    if (!refreshSignal || !selectedCustomer) return;
    loadJobs(selectedCustomer.id);
  }, [refreshSignal]);

  const openNewJob = () => {
    if (!selectedCustomer) return;
    setSelectedJob(null);
    setJobFormData(createRecurringJobDraft());
    setSharedSnapshot(cloneSnapshot(createRecurringSnapshot(selectedCustomer)));
    setJobPlanRows([createRecurringJobDraft()]);
    setView('jobForm');
  };

  const openEditJob = job => {
    setSelectedJob(job);
    setJobFormData({
      ...normalizeDraftState(job),
      snapshot: cloneSnapshot({ ...createRecurringSnapshot(selectedCustomer || {}), ...(job.snapshot || {}) }),
    });
    setView('jobForm');
  };

  const updateSharedSnapshot = (field, value) => {
    setSharedSnapshot(prev => cloneSnapshot({ ...prev, [field]: value }));
  };

  const updatePlanRow = (draftId, updater) => {
    setJobPlanRows(prev => prev.map(row => (
      row.draftId === draftId
        ? normalizeDraftState(typeof updater === 'function' ? updater(row) : { ...row, ...updater })
        : row
    )));
  };

  const addPlanRow = overrides => {
    setJobPlanRows(prev => [...prev, createRecurringJobDraft(overrides)]);
  };

  const duplicatePlanRow = draftId => {
    setJobPlanRows(prev => {
      const target = prev.find(row => row.draftId === draftId);
      if (!target) return prev;
      return [...prev, createRecurringJobDraft({ ...target, draftId: uid() })];
    });
  };

  const removePlanRow = draftId => {
    setJobPlanRows(prev => prev.length <= 1 ? prev : prev.filter(row => row.draftId !== draftId));
  };

  const setPlanScheduleMode = (draftId, scheduleMode) => {
    updatePlanRow(draftId, row => {
      const nextMode = scheduleMode === 'specific' ? 'specific' : 'interval';
      const nextMonths = nextMode === 'specific' && normalizeRecurringSelectedMonths(row.selected_months).length === 0
        ? [Math.min(12, Math.max(1, Number(row.start_month) || (new Date().getMonth() + 1)))]
        : row.selected_months;
      return { ...row, schedule_mode: nextMode, selected_months: nextMonths };
    });
  };

  const togglePlanMonth = (draftId, monthValue) => {
    updatePlanRow(draftId, row => {
      const selectedMonths = normalizeRecurringSelectedMonths(row.selected_months);
      const nextMonths = selectedMonths.includes(monthValue)
        ? selectedMonths.filter(month => month !== monthValue)
        : [...selectedMonths, monthValue];
      return { ...row, selected_months: nextMonths };
    });
  };

  const updateEditJob = updater => {
    setJobFormData(prev => {
      const nextSource = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      return {
        ...normalizeDraftState(nextSource),
        snapshot: cloneSnapshot(nextSource.snapshot),
      };
    });
  };

  const setEditScheduleMode = scheduleMode => {
    updateEditJob(prev => {
      const nextMode = scheduleMode === 'specific' ? 'specific' : 'interval';
      const nextMonths = nextMode === 'specific' && normalizeRecurringSelectedMonths(prev.selected_months).length === 0
        ? [Math.min(12, Math.max(1, Number(prev.start_month) || (new Date().getMonth() + 1)))]
        : prev.selected_months;
      return { ...prev, schedule_mode: nextMode, selected_months: nextMonths };
    });
  };

  const toggleEditMonth = monthValue => {
    updateEditJob(prev => {
      const selectedMonths = normalizeRecurringSelectedMonths(prev.selected_months);
      const nextMonths = selectedMonths.includes(monthValue)
        ? selectedMonths.filter(month => month !== monthValue)
        : [...selectedMonths, monthValue];
      return { ...prev, selected_months: nextMonths };
    });
  };

  const validateDraftRows = rows => {
    const preparedRows = rows
      .map(normalizeDraftState)
      .filter(row => row.service_label.trim() || Number(row.price) || String(row.notes || '').trim() || normalizeRecurringSelectedMonths(row.selected_months).length > 0);
    if (preparedRows.length === 0) throw new Error('Add at least one service row before saving.');
    const missingServiceIndex = preparedRows.findIndex(row => !String(row.service_label || '').trim());
    if (missingServiceIndex >= 0) throw new Error(`Service name is required for row ${missingServiceIndex + 1}.`);
    const missingMonthsIndex = preparedRows.findIndex(row => row.schedule_mode === 'specific' && normalizeRecurringSelectedMonths(row.selected_months).length === 0);
    if (missingMonthsIndex >= 0) throw new Error(`Choose at least one month for row ${missingMonthsIndex + 1}.`);
    return preparedRows;
  };

  const handleSaveJob = async () => {
    if (!selectedCustomer) {
      setError('Select a customer before saving a recurring job.');
      return;
    }
    try {
      setError('');
      if (selectedJob) {
        const normalizedDraft = normalizeDraftState(jobFormData);
        if (!String(normalizedDraft.service_label || '').trim()) throw new Error('Service name is required.');
        if (normalizedDraft.schedule_mode === 'specific' && normalizeRecurringSelectedMonths(normalizedDraft.selected_months).length === 0) {
          throw new Error('Choose at least one month for this recurring job.');
        }

        const payload = buildRecurringJobPayload(normalizedDraft, cloneSnapshot(normalizedDraft.snapshot));
        const saved = await runApiFetch(`/api/v1/customer-jobs/${selectedJob.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        await loadJobs(selectedCustomer.id);
        setSelectedJob(null);
        setView('jobs');
        onJobAction('updated', saved || payload);
        return;
      }

      const preparedRows = validateDraftRows(jobPlanRows);
      const payloadRows = preparedRows.map(row => buildRecurringJobPayload(row, sharedSnapshot));
      const createdJobs = await runApiFetch(`/api/v1/customers/${selectedCustomer.id}/jobs/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: payloadRows }),
      });

      await loadJobs(selectedCustomer.id);
      setView('jobs');
      setJobPlanRows([createRecurringJobDraft()]);
      setSharedSnapshot(cloneSnapshot(createRecurringSnapshot(selectedCustomer)));

      if (Array.isArray(createdJobs) && createdJobs.length > 1) onJobAction('bulkCreated', { count: createdJobs.length, customerName: selectedCustomer.name });
      else onJobAction('created', Array.isArray(createdJobs) && createdJobs[0] ? createdJobs[0] : payloadRows[0]);
    } catch (err) {
      setError(err?.message || 'Failed to save recurring job.');
    }
  };

  const handleDeleteJob = async jobId => {
    if (!selectedCustomer) return;
    if (!window.confirm('Delete this recurring job permanently?')) return;
    try {
      setError('');
      await runApiFetch(`/api/v1/customer-jobs/${jobId}`, { method: 'DELETE' });
      await loadJobs(selectedCustomer.id);
      onJobAction('deleted', { id: jobId });
    } catch (err) {
      setError(err?.message || 'Failed to delete recurring job.');
    }
  };

  const handlePushOccurrence = async () => {
    if (!selectedJob || !showPushModal) return;
    try {
      setError('');
      const nextYear = Number(pushFormData.year) || new Date().getFullYear();
      const nextMonth = Number(pushFormData.month) || 1;
      const nextWeekSlot = Number(pushFormData.week_slot) || 1;
      await runApiFetch(`/api/v1/customer-jobs/${selectedJob.id}/occurrences/${showPushModal}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: nextYear,
          month: nextMonth,
          week_slot: nextWeekSlot,
        }),
      });
      setShowPushModal(null);
      await loadOccurrences(selectedJob.id);
      onJobAction('occurrencePushed', { ...selectedJob, year: nextYear, month: nextMonth, week_slot: nextWeekSlot });
    } catch (err) {
      setError(err?.message || 'Failed to push occurrence.');
    }
  };

  const handlePrepareInvoice = async occId => {
    if (!selectedJob) return;
    try {
      setError('');
      await runApiFetch(`/api/v1/customer-jobs/${selectedJob.id}/occurrences/${occId}/prepare-invoice`, {
        method: 'POST',
      });
      await loadOccurrences(selectedJob.id);
      onJobAction('invoicePrepared', { ...selectedJob, occurrenceId: occId });
    } catch (err) {
      setError(err?.message || 'Failed to prepare invoice.');
    }
  };

  const backToCustomers = () => {
    setView('customers');
    setSelectedCustomer(null);
    setSelectedJob(null);
    setOccurrences([]);
    setError('');
  };

  const backToJobs = () => {
    setView('jobs');
    setSelectedJob(null);
    setOccurrences([]);
    setError('');
  };

  const renderMonthButtons = (selectedMonths, onToggle) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
      {RECURRING_MONTH_OPTIONS.map(month => {
        const active = selectedMonths.includes(month.value);
        return (
          <button
            key={month.value}
            type="button"
            className="btn btn-sm"
            style={{
              background: active ? 'var(--accent)' : 'var(--panel)',
              color: active ? '#0b1020' : 'var(--text)',
              borderColor: active ? 'var(--accent)' : 'var(--border)',
            }}
            onClick={() => onToggle(month.value)}
          >
            {month.label}
          </button>
        );
      })}
    </div>
  );

  const renderDraftFields = (draft, handlers) => {
    const selectedMonths = normalizeRecurringSelectedMonths(draft.selected_months);
    return (
      <>
        <div className="row3">
          <div className="modal-field">
            <label>Service Name</label>
            <input list="recurring-service-presets" value={draft.service_label || ''} onChange={e => handlers.onField('service_label', e.target.value)} placeholder="Inside/Outside Storefront" />
          </div>
          <div className="modal-field">
            <label>Price</label>
            <input type="number" min="0" step="0.01" value={draft.price ?? 0} onChange={e => handlers.onField('price', e.target.value)} />
          </div>
          <div className="modal-field">
            <label>Status</label>
            <select value={draft.status || 'active'} onChange={e => handlers.onField('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="row3">
          <div className="modal-field">
            <label>Schedule Type</label>
            <select value={draft.schedule_mode || 'interval'} onChange={e => handlers.onScheduleMode(e.target.value)}>
              <option value="interval">Every N Months</option>
              <option value="specific">Specific Months</option>
            </select>
          </div>
          <div className="modal-field">
            <label>Target Week</label>
            <select value={draft.week_slot || 1} onChange={e => handlers.onField('week_slot', Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map(week => <option key={week} value={week}>Week {week}</option>)}
            </select>
          </div>
          <div className="modal-field">
            <label>Start Year</label>
            <input type="number" min="2000" max="2100" value={draft.start_year || new Date().getFullYear()} onChange={e => handlers.onField('start_year', Number(e.target.value))} />
          </div>
        </div>

        {draft.schedule_mode === 'specific' ? (
          <>
            <div className="row">
              <div className="modal-field">
                <label>First Eligible Month</label>
                <select value={draft.start_month || (new Date().getMonth() + 1)} onChange={e => handlers.onField('start_month', Number(e.target.value))}>
                  {RECURRING_MONTH_OPTIONS.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
                </select>
              </div>
              <div className="modal-field">
                <label>Selected Pattern</label>
                <div className="note" style={{ marginTop: 0, minHeight: 48, display: 'flex', alignItems: 'center' }}>
                  {selectedMonths.length > 0 ? recurringMonthLabelList(selectedMonths).join(', ') : 'Choose one or more months for this service.'}
                </div>
              </div>
            </div>
            <div className="modal-field">
              <label>Run In These Months</label>
              <div className="flex-row" style={{ marginBottom: 10 }}>
                <button type="button" className="btn btn-sm" onClick={handlers.onSelectAllMonths}>All Months</button>
                <button type="button" className="btn btn-sm" onClick={handlers.onClearMonths}>Clear</button>
              </div>
              {renderMonthButtons(selectedMonths, handlers.onToggleMonth)}
              <div className="small" style={{ marginTop: 8 }}>
                The first cycle starts at or after {recurringMonthLabel(draft.start_month || (new Date().getMonth() + 1))} {draft.start_year || new Date().getFullYear()}.
              </div>
            </div>
          </>
        ) : (
          <div className="row">
            <div className="modal-field">
              <label>Recurrence (Months)</label>
              <select value={draft.interval_months || 1} onChange={e => handlers.onField('interval_months', Number(e.target.value))}>
                <option value={1}>Monthly</option>
                <option value={2}>Bimonthly</option>
                <option value={3}>Quarterly</option>
                <option value={6}>Biannual</option>
                <option value={12}>Annual</option>
              </select>
            </div>
            <div className="modal-field">
              <label>Start Month</label>
              <select value={draft.start_month || (new Date().getMonth() + 1)} onChange={e => handlers.onField('start_month', Number(e.target.value))}>
                {RECURRING_MONTH_OPTIONS.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="modal-field">
          <label>Internal Notes</label>
          <textarea rows={3} value={draft.notes || ''} onChange={e => handlers.onField('notes', e.target.value)} placeholder="Optional route or service notes..." />
        </div>
      </>
    );
  };

  const planSaveCount = Math.max(
    1,
    jobPlanRows.filter(row => row.service_label.trim() || Number(row.price) || String(row.notes || '').trim() || normalizeRecurringSelectedMonths(row.selected_months).length > 0).length
  );
  const planSaveLabel = `Save ${planSaveCount} ${planSaveCount === 1 ? 'Job' : 'Jobs'}`;

  return (
    <div>
      <div className="title-row">
        <div>
          <div className="pill">Recurring Revenue Module</div>
          <h2>Customer Jobs</h2>
          <div className="sub">Manage recurring customer service templates, future cycles, and invoice-ready occurrences.</div>
        </div>
        <div className="flex-row">
          {view !== 'customers' && <button className="btn btn-sm" onClick={backToCustomers}>All Customers</button>}
          {(view === 'jobForm' || view === 'occurrences') && <button className="btn btn-sm" onClick={backToJobs}>Back to Jobs</button>}
        </div>
      </div>

      <datalist id="recurring-service-presets">
        {RECURRING_SERVICE_PRESETS.map(service => <option key={service} value={service} />)}
      </datalist>

      {error && <div className="alert">{error}</div>}

      {view === 'customers' && (
        normalizedCustomers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--muted)' }}>No customers available. Add a customer first.</div>
        ) : (
          <div className="grid">
            {normalizedCustomers.map(customer => (
              <section key={customer.id} className="card span-4">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
                  <div>
                    <h3 style={{ marginTop: 0, marginBottom: 6 }}>{customer.name}</h3>
                    <div className="small">{[customer.city, customer.state].filter(Boolean).join(', ') || 'No city/state set'}</div>
                    {customer.street && <div style={{ marginTop: 10, fontSize: 14 }}>{customer.street}</div>}
                    {(customer.phone || customer.email) && <div className="small" style={{ marginTop: 10 }}>{[customer.phone, customer.email].filter(Boolean).join(' â€¢ ')}</div>}
                  </div>
                  <button className="btn btn-accent btn-sm" onClick={() => openCustomerJobs(customer)}>Manage Jobs</button>
                </div>
              </section>
            ))}
          </div>
        )
      )}

      {view === 'jobs' && selectedCustomer && (
        <div>
          <div className="note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{selectedCustomer.name}</div>
              <div className="small">{[selectedCustomer.street, [selectedCustomer.city, selectedCustomer.state, selectedCustomer.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>
              <div className="small" style={{ marginTop: 4 }}>Use one plan screen to create multiple separate recurring services for this customer.</div>
            </div>
            <button className="btn btn-accent btn-sm" onClick={openNewJob}>Create Plan</button>
          </div>

          {jobs.length === 0 ? (
            <div className="card" style={{ color: 'var(--muted)' }}>No recurring jobs yet for this customer.</div>
          ) : (
            jobs.map(job => (
              <section key={job.id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <h3 style={{ margin: 0 }}>{job.service_label}</h3>
                      <span className={`badge ${job.status === 'active' ? 'badge-good' : ''}`}>{String(job.status || 'active').toUpperCase()}</span>
                    </div>
                    <div className="small">{money(job.price || 0)} | {getRecurringScheduleSummary(job)}</div>
                    {job.notes && <div style={{ marginTop: 8, fontSize: 14, color: 'var(--muted)' }}>{job.notes}</div>}
                  </div>
                  <div className="flex-row">
                    <button className="btn btn-sm" onClick={() => openEditJob(job)}>Edit</button>
                    <button className="btn btn-accent btn-sm" onClick={async () => { setSelectedJob(job); await loadOccurrences(job.id); setView('occurrences'); }}>Schedule</button>
                    {canExecuteDelete
                      ? <button className="btn btn-danger btn-sm" onClick={() => handleDeleteJob(job.id)}>Delete</button>
                      : <button className="btn btn-danger btn-sm" onClick={() => onRequestDelete('recurringJob', job.id, job.service_label || `Job #${job.id}`)}>Request Delete</button>
                    }
                  </div>
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {view === 'jobForm' && !selectedJob && (
        <section className="card">
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 6 }}>Create Recurring Plan</h3>
            <div className="small">Each row below saves as its own recurring job, so you can build storefront, back-of-store, entire store, or pressure washing schedules in one place.</div>
          </div>

          <div className="note" style={{ marginTop: 0, marginBottom: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Quick Add Service Rows</div>
            <div className="flex-row">
              {RECURRING_SERVICE_PRESETS.map(service => (
                <button key={service} type="button" className="btn btn-sm" onClick={() => addPlanRow({ service_label: service })}>{service}</button>
              ))}
              <button type="button" className="btn btn-accent btn-sm" onClick={() => addPlanRow()}>Blank Service Row</button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {jobPlanRows.map((row, index) => (
              <div key={row.draftId} className="note" style={{ marginTop: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', marginBottom: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Service Row {index + 1}</div>
                    <div className="small">{getRecurringScheduleSummary(row)}</div>
                  </div>
                  <div className="flex-row">
                    <button type="button" className="btn btn-sm" onClick={() => duplicatePlanRow(row.draftId)}>Duplicate</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removePlanRow(row.draftId)} disabled={jobPlanRows.length <= 1}>Remove</button>
                  </div>
                </div>

                {renderDraftFields(row, {
                  onField: (field, value) => updatePlanRow(row.draftId, { [field]: value }),
                  onScheduleMode: value => setPlanScheduleMode(row.draftId, value),
                  onToggleMonth: value => togglePlanMonth(row.draftId, value),
                  onSelectAllMonths: () => updatePlanRow(row.draftId, { selected_months: RECURRING_MONTH_OPTIONS.map(month => month.value) }),
                  onClearMonths: () => updatePlanRow(row.draftId, { selected_months: [] }),
                })}
              </div>
            ))}
          </div>

          <div className="note" style={{ marginBottom: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Shared Invoice Snapshot</div>
            <div className="small" style={{ marginBottom: 12 }}>This snapshot is copied into each new recurring job created from this plan. You can edit individual jobs later if one location needs different billing details.</div>
            <div className="modal-field">
              <label>Name on Invoice</label>
              <input value={sharedSnapshot.name || ''} onChange={e => updateSharedSnapshot('name', e.target.value)} />
            </div>
            <div className="modal-field">
              <label>Street</label>
              <input value={sharedSnapshot.street || ''} onChange={e => updateSharedSnapshot('street', e.target.value)} />
            </div>
            <div className="row3">
              <div className="modal-field">
                <label>City</label>
                <input value={sharedSnapshot.city || ''} onChange={e => updateSharedSnapshot('city', e.target.value)} />
              </div>
              <div className="modal-field">
                <label>State</label>
                <input value={sharedSnapshot.state || ''} onChange={e => updateSharedSnapshot('state', e.target.value)} />
              </div>
              <div className="modal-field">
                <label>ZIP</label>
                <input value={sharedSnapshot.zip || ''} onChange={e => updateSharedSnapshot('zip', e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div className="modal-field">
                <label>Phone</label>
                <input value={sharedSnapshot.phone || ''} onChange={e => updateSharedSnapshot('phone', e.target.value)} />
              </div>
              <div className="modal-field">
                <label>Email</label>
                <input value={sharedSnapshot.email || ''} onChange={e => updateSharedSnapshot('email', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex-row" style={{ marginTop: 18 }}>
            <button className="btn btn-accent" onClick={handleSaveJob}>{planSaveLabel}</button>
            <button className="btn btn-sm" onClick={backToJobs}>Cancel</button>
          </div>
        </section>
      )}

      {view === 'jobForm' && selectedJob && (
        <section className="card">
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 6 }}>Edit Recurring Job</h3>
            <div className="small">Update the service details, change to specific months, or keep a simple month interval.</div>
          </div>

          <div className="row" style={{ gap: 20, alignItems: 'start' }}>
            <div>
              {renderDraftFields(jobFormData, {
                onField: (field, value) => updateEditJob({ [field]: value }),
                onScheduleMode: value => setEditScheduleMode(value),
                onToggleMonth: value => toggleEditMonth(value),
                onSelectAllMonths: () => updateEditJob({ selected_months: RECURRING_MONTH_OPTIONS.map(month => month.value) }),
                onClearMonths: () => updateEditJob({ selected_months: [] }),
              })}
            </div>

            <div className="note" style={{ marginTop: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Invoice Snapshot</div>
              <div className="small" style={{ marginBottom: 12 }}>This copy is stored on the recurring job and can differ from the master customer record.</div>
              <div className="modal-field">
                <label>Name on Invoice</label>
                <input value={jobFormData.snapshot?.name || ''} onChange={e => updateEditJob(prev => ({ ...prev, snapshot: { ...(prev.snapshot || {}), name: e.target.value } }))} />
              </div>
              <div className="modal-field">
                <label>Street</label>
                <input value={jobFormData.snapshot?.street || ''} onChange={e => updateEditJob(prev => ({ ...prev, snapshot: { ...(prev.snapshot || {}), street: e.target.value } }))} />
              </div>
              <div className="row3">
                <div className="modal-field">
                  <label>City</label>
                  <input value={jobFormData.snapshot?.city || ''} onChange={e => updateEditJob(prev => ({ ...prev, snapshot: { ...(prev.snapshot || {}), city: e.target.value } }))} />
                </div>
                <div className="modal-field">
                  <label>State</label>
                  <input value={jobFormData.snapshot?.state || ''} onChange={e => updateEditJob(prev => ({ ...prev, snapshot: { ...(prev.snapshot || {}), state: e.target.value } }))} />
                </div>
                <div className="modal-field">
                  <label>ZIP</label>
                  <input value={jobFormData.snapshot?.zip || ''} onChange={e => updateEditJob(prev => ({ ...prev, snapshot: { ...(prev.snapshot || {}), zip: e.target.value } }))} />
                </div>
              </div>
              <div className="row">
                <div className="modal-field">
                  <label>Phone</label>
                  <input value={jobFormData.snapshot?.phone || ''} onChange={e => updateEditJob(prev => ({ ...prev, snapshot: { ...(prev.snapshot || {}), phone: e.target.value } }))} />
                </div>
                <div className="modal-field">
                  <label>Email</label>
                  <input value={jobFormData.snapshot?.email || ''} onChange={e => updateEditJob(prev => ({ ...prev, snapshot: { ...(prev.snapshot || {}), email: e.target.value } }))} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex-row" style={{ marginTop: 18 }}>
            <button className="btn btn-accent" onClick={handleSaveJob}>Save Changes</button>
            <button className="btn btn-sm" onClick={backToJobs}>Cancel</button>
          </div>
        </section>
      )}

      {view === 'occurrences' && selectedJob && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>{selectedJob.service_label}</h3>
              <div className="small">{selectedCustomer?.name || 'Customer'} | {money(selectedJob.price || 0)} | {getRecurringScheduleSummary(selectedJob)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Year / Month</th>
                <th>Week</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {occurrences.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ color: 'var(--muted)' }}>No occurrences generated yet.</td>
                </tr>
              ) : occurrences.map(occurrence => (
                <tr key={occurrence.id}>
                  <td className="mono">{occurrence.year}-{String(occurrence.month).padStart(2, '0')}</td>
                  <td>Week {occurrence.week_slot}</td>
                  <td>{occurrence.invoice_prepared ? <span className="good">Invoice Ready</span> : occurrence.status}</td>
                  <td>
                    <div className="flex-row">
                      {!occurrence.invoice_prepared && (
                        <>
                          <button className="btn btn-sm" onClick={() => {
                            setPushFormData({ year: occurrence.year, month: occurrence.month, week_slot: occurrence.week_slot });
                            setShowPushModal(occurrence.id);
                          }}>Push</button>
                          <button className="btn btn-accent btn-sm" onClick={() => handlePrepareInvoice(occurrence.id)}>Prep Invoice</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {showPushModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowPushModal(null); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Push Occurrence</h3>
              <button className="modal-close" onClick={() => setShowPushModal(null)}>&times;</button>
            </div>
            <div className="small" style={{ marginBottom: 14 }}>Move this cycle without changing the recurring template.</div>
            <div className="row3">
              <div className="modal-field">
                <label>Year</label>
                <input type="number" min="2000" max="2100" value={pushFormData.year} onChange={e => setPushFormData(prev => ({ ...prev, year: e.target.value }))} />
              </div>
              <div className="modal-field">
                <label>Month</label>
                <input type="number" min="1" max="12" value={pushFormData.month} onChange={e => setPushFormData(prev => ({ ...prev, month: e.target.value }))} />
              </div>
              <div className="modal-field">
                <label>Week Slot</label>
                <select value={pushFormData.week_slot} onChange={e => setPushFormData(prev => ({ ...prev, week_slot: e.target.value }))}>
                  {[1, 2, 3, 4, 5].map(week => <option key={week} value={week}>Week {week}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={() => setShowPushModal(null)}>Cancel</button>
              <button className="btn btn-accent btn-sm" onClick={handlePushOccurrence}>Confirm Push</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ INTAKE IMPORTS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function IntakeImportsTab({ customers, setCustomers, serviceJobs, setServiceJobs, setActiveTab, setCustomerEditRequest, apiFetch: intakeApiFetch, onIntakeAction = () => { } }) {
  const [imports, setImports] = useState([]);
  const [selectedImportId, setSelectedImportId] = useState(null);
  const [selectedImport, setSelectedImport] = useState(null);
  const [matchData, setMatchData] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [createEstimateJob, setCreateEstimateJob] = useState(true);
  const [forceNewCustomer, setForceNewCustomer] = useState(false);
  const [linkCustomerId, setLinkCustomerId] = useState('');
  const [converting, setConverting] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');
  const [manualPasteSubmitting, setManualPasteSubmitting] = useState(false);
  const [manualPastePreview, setManualPastePreview] = useState(null);
  const [manualPasteSource, setManualPasteSource] = useState('');
  const [manualPasteSubmittedAt, setManualPasteSubmittedAt] = useState('');
  const [manualPasteCreateEstimateJob, setManualPasteCreateEstimateJob] = useState(true);
  const runApiFetch = intakeApiFetch || apiFetch;

  const sortedCustomers = useMemo(
    () => [...(customers || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [customers]
  );

  const upsertCustomer = customer => {
    if (!customer?.id) return;
    setCustomers(prev => {
      const exists = prev.some(item => String(item.id) === String(customer.id));
      if (!exists) return [...prev, customer].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      return prev.map(item => String(item.id) === String(customer.id) ? { ...item, ...customer } : item);
    });
  };

  const upsertServiceJob = job => {
    if (!job?.id) return;
    const normalizedJob = withJobFinancialDefaults(job);
    setServiceJobs(prev => {
      const exists = prev.some(item => String(item.id) === String(normalizedJob.id));
      const next = exists
        ? prev.map(item => String(item.id) === String(normalizedJob.id) ? { ...item, ...normalizedJob } : item)
        : [...prev, normalizedJob];
      return [...next].sort((a, b) => (Number(a.jobNumber) || 0) - (Number(b.jobNumber) || 0));
    });
  };

  const updateLocalImport = updatedImport => {
    if (!updatedImport?.id) return;
    setImports(prev => {
      const exists = prev.some(item => Number(item.id) === Number(updatedImport.id));
      const next = exists
        ? prev.map(item => Number(item.id) === Number(updatedImport.id) ? updatedImport : item)
        : [updatedImport, ...prev];
      return [...next].sort((a, b) => String(b.importedAt || '').localeCompare(String(a.importedAt || '')));
    });
    setSelectedImport(updatedImport);
  };

  const formatTimestamp = value => {
    if (!value) return 'Unknown';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  };

  const refreshImports = useCallback(async preferredId => {
    setLoading(true);
    setRequestError('');
    try {
      const data = await runApiFetch('/api/v1/intake-imports?limit=200', { method: 'GET' });
      const nextImports = Array.isArray(data?.imports) ? data.imports : [];
      setImports(nextImports);
      const targetId = preferredId;
      if (targetId && nextImports.some(item => Number(item.id) === Number(targetId))) setSelectedImportId(targetId);
      else setSelectedImportId(nextImports[0]?.id || null);
      return nextImports;
    } catch (err) {
      setImports([]);
      setSelectedImportId(null);
      setRequestError(err?.message || 'Failed to load intake imports.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [runApiFetch]);

  const loadImportDetail = useCallback(async importId => {
    if (!importId) {
      setSelectedImport(null);
      setMatchData(null);
      setLinkCustomerId('');
      return;
    }
    setDetailLoading(true);
    setRequestError('');
    try {
      const [intakeImport, candidateData] = await Promise.all([
        runApiFetch(`/api/v1/intake-imports/${importId}`, { method: 'GET' }),
        runApiFetch(`/api/v1/intake-imports/${importId}/match-candidates`, { method: 'GET' }),
      ]);
      setSelectedImport(intakeImport || null);
      setMatchData(candidateData || null);
      setLinkCustomerId(String(candidateData?.recommendedCustomerId || intakeImport?.matchedCustomerId || intakeImport?.convertedCustomerId || ''));
      const lead = candidateData?.leadSummary || intakeImport?.leadSummary || {};
      setCreateEstimateJob(Boolean(lead.serviceCategory || lead.estimateTotal || lead.notes || (lead.lineItems && lead.lineItems.length > 0)));
      setForceNewCustomer(false);
    } catch (err) {
      setSelectedImport(null);
      setMatchData(null);
      setLinkCustomerId('');
      setRequestError(err?.message || 'Failed to load intake review details.');
    } finally {
      setDetailLoading(false);
    }
  }, [runApiFetch]);

  useEffect(() => {
    refreshImports();
  }, [refreshImports]);

  useEffect(() => {
    loadImportDetail(selectedImportId);
  }, [selectedImportId, loadImportDetail]);

  const visibleImports = useMemo(() => {
    if (statusFilter === 'all') return imports;
    if (statusFilter === 'converted') return imports.filter(item => item.intakeStatus === 'converted');
    if (statusFilter === 'reviewed') return imports.filter(item => item.intakeStatus === 'reviewed');
    return imports.filter(item => item.intakeStatus !== 'converted');
  }, [imports, statusFilter]);

  const leadSummary = selectedImport?.leadSummary || matchData?.leadSummary || null;
  const candidateList = Array.isArray(matchData?.candidates) ? matchData.candidates : [];
  const computedMatchStatus = matchData?.computedMatchStatus || selectedImport?.customerMatchStatus || 'unmatched';
  const blockNewCustomer = Boolean(matchData?.blockNewCustomer);

  const intakeStatusClass = status => status === 'converted' ? 'badge-good' : status === 'reviewed' ? '' : 'badge-warn';
  const matchStatusClass = status => ['matched', 'created_new'].includes(status) ? 'badge-good' : status === 'ambiguous' ? 'badge-warn' : '';

  const handleMarkReviewed = async () => {
    if (!selectedImport?.id) return;
    try {
      setRequestError('');
      const updated = await runApiFetch(`/api/v1/intake-imports/${selectedImport.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake_status: 'reviewed',
          customer_match_status: computedMatchStatus,
          matched_customer_id: linkCustomerId || selectedImport.matchedCustomerId || '',
        }),
      });
      updateLocalImport(updated);
      onIntakeAction('reviewed', { intakeImport: updated });
    } catch (err) {
      setRequestError(err?.message || 'Failed to mark intake import reviewed.');
    }
  };

  const handleConvert = async ({ action, existingCustomerId = '' }) => {
    if (!selectedImport?.id || converting) return;
    try {
      setConverting(true);
      setRequestError('');
      const response = await runApiFetch(`/api/v1/intake-imports/${selectedImport.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          existingCustomerId,
          createEstimateJob,
          forceNewCustomer,
        }),
      });
      if (response?.customer) upsertCustomer(response.customer);
      if (response?.serviceJob) upsertServiceJob(response.serviceJob);
      if (response?.intakeImport) updateLocalImport(response.intakeImport);
      await refreshImports(selectedImport.id);
      await loadImportDetail(selectedImport.id);
      onIntakeAction(
        response?.alreadyConverted ? 'alreadyConverted' : (action === 'link_existing' ? 'linked' : 'created'),
        response
      );
    } catch (err) {
      setRequestError(err?.message || 'Failed to convert intake import.');
    } finally {
      setConverting(false);
    }
  };

  const resetManualPasteForm = () => {
    setManualPasteText('');
    setManualPastePreview(null);
    setManualPasteSource('');
    setManualPasteSubmittedAt('');
  };

  const submitManualPasteImport = async () => {
    const text = manualPasteText.trim();
    if (!text) { setRequestError('Paste text cannot be empty.'); return; }
    const knownFields = ['NAME:', 'PHONE:', 'EMAIL:', 'ADDRESS:', 'SERVICES REQUESTED:', 'NOTES:'];
    if (!knownFields.some(f => text.toUpperCase().includes(f))) {
      setRequestError('Pasted block must contain at least one recognized field: NAME:, PHONE:, EMAIL:, ADDRESS:, SERVICES REQUESTED:, or NOTES:');
      return;
    }
    setManualPasteSubmitting(true);
    setRequestError('');
    try {
      const response = await runApiFetch('/api/v1/intake-imports/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: text,
          source: manualPasteSource || 'manual_paste',
          submittedAt: manualPasteSubmittedAt || '',
          createEstimateJob: manualPasteCreateEstimateJob,
        }),
      });
      const imported = response.intakeImport || response;
      if (response.leadSummary) setManualPastePreview(response.leadSummary);
      updateLocalImport(imported);
      await refreshImports(imported?.id);
      setSelectedImportId(imported?.id || null);
      await loadImportDetail(imported?.id);
      onIntakeAction('manualImported', response);
      resetManualPasteForm();
    } catch (err) {
      setRequestError(err?.message || 'Failed to import pasted intake.');
    } finally {
      setManualPasteSubmitting(false);
    }
  };

  return (
    <div>
      <div className="title-row">
        <div>
          <div className="pill">Lead Intake Module</div>
          <h2>Website Intake Review</h2>
          <div className="sub">Convert imported website submissions into real leads and estimate jobs with match review before duplicates get created.</div>
        </div>
        <div className="flex-row">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 180 }}>
            <option value="open">Open Queue</option>
            <option value="converted">Converted</option>
            <option value="reviewed">Reviewed</option>
            <option value="all">All Imports</option>
          </select>
          <button className="btn btn-sm" onClick={() => refreshImports(selectedImportId)} disabled={loading}>Refresh</button>
        </div>
      </div>

      {requestError && <div className="alert">{requestError}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Manual Paste Intake</h3>
          <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
            Paste a website estimate email body to create a new intake record for review. Does not create a customer.
          </div>
        </div>
        <textarea
          value={manualPasteText}
          onChange={e => setManualPasteText(e.target.value)}
          rows={8}
          placeholder={'Paste the full estimate email body here...\n\n=== NEW ESTIMATE REQUEST ===\nNAME:    ...\nPHONE:   ...\nEMAIL:   ...\nADDRESS: ...\nSERVICES REQUESTED:\n  - ...'}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'monospace', fontSize: 13, background: 'var(--panel-soft)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, color: 'var(--text)' }}
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="small" style={{ display: 'block', marginBottom: 4, color: 'var(--muted)' }}>Form Source (optional)</label>
            <input type="text" value={manualPasteSource} onChange={e => setManualPasteSource(e.target.value)}
              placeholder="e.g. email, manual_paste"
              style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="small" style={{ display: 'block', marginBottom: 4, color: 'var(--muted)' }}>Submitted At (optional)</label>
            <input type="datetime-local" value={manualPasteSubmittedAt} onChange={e => setManualPasteSubmittedAt(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer', fontSize: 14 }}>
          <input type="checkbox" checked={manualPasteCreateEstimateJob} onChange={e => setManualPasteCreateEstimateJob(e.target.checked)} />
          Create estimate job after conversion
        </label>
        {manualPastePreview && (
          <div className="note" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Parsed Preview</div>
            <div className="row">
              <div><div className="small">Name</div><div>{manualPastePreview.name || 'â€”'}</div></div>
              <div><div className="small">Address</div><div>{manualPastePreview.address || 'â€”'}</div></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <div><div className="small">Phone</div><div>{manualPastePreview.phone || 'â€”'}</div></div>
              <div><div className="small">Service</div><div>{manualPastePreview.serviceCategory || 'â€”'}</div></div>
              {manualPastePreview.estimateTotal > 0 && (
                <div><div className="small">Estimate</div><div>{money(manualPastePreview.estimateTotal)}</div></div>
              )}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-accent" onClick={submitManualPasteImport} disabled={manualPasteSubmitting}>
            {manualPasteSubmitting ? 'Importingâ€¦' : 'Import to Queue'}
          </button>
          <button className="btn btn-sm" onClick={resetManualPasteForm} disabled={manualPasteSubmitting}>Clear</button>
        </div>
      </div>

      <div className="grid">
        <section className="card span-5" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Imported Leads</h3>
            <div className="small">{visibleImports.length} visible</div>
          </div>
          {loading ? (
            <div style={{ color: 'var(--muted)', padding: '24px 0' }}>Loading intake imports...</div>
          ) : visibleImports.length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: '24px 0' }}>No intake imports match this filter.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Service</th>
                  <th>Match</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleImports.map(item => {
                  const lead = item.leadSummary || {};
                  const isSelected = Number(item.id) === Number(selectedImportId);
                  return (
                    <tr key={item.id} onClick={() => setSelectedImportId(item.id)} style={{ cursor: 'pointer', background: isSelected ? 'rgba(110,168,254,0.08)' : 'transparent' }}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{lead.name || 'Unnamed lead'}</div>
                        <div className="small">{lead.address || lead.phone || 'No location on file'}</div>
                        <div className="small" style={{ marginTop: 4 }}>{formatTimestamp(item.submittedAt || item.importedAt)}</div>
                      </td>
                      <td>
                        <div>{lead.serviceCategory || 'General inquiry'}</div>
                        {lead.estimateTotal > 0 && <div className="small">{money(lead.estimateTotal)}</div>}
                      </td>
                      <td><span className={`badge ${matchStatusClass(item.customerMatchStatus)}`}>{item.customerMatchStatus || 'unmatched'}</span></td>
                      <td><span className={`badge ${intakeStatusClass(item.intakeStatus)}`}>{item.intakeStatus || 'imported'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="card span-7">
          {!selectedImportId ? (
            <div style={{ color: 'var(--muted)' }}>Select an intake import to review it.</div>
          ) : detailLoading ? (
            <div style={{ color: 'var(--muted)' }}>Loading intake details...</div>
          ) : !selectedImport ? (
            <div style={{ color: 'var(--muted)' }}>This intake import could not be loaded.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>{leadSummary?.name || 'Website lead'}</h3>
                    <span className={`badge ${matchStatusClass(computedMatchStatus)}`}>{computedMatchStatus}</span>
                    <span className={`badge ${intakeStatusClass(selectedImport.intakeStatus)}`}>{selectedImport.intakeStatus || 'imported'}</span>
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    #{selectedImport.websiteSubmissionId} | {selectedImport.formType || 'website'} | submitted {formatTimestamp(selectedImport.submittedAt || selectedImport.importedAt)}
                  </div>
                </div>
                <div className="flex-row">
                  {selectedImport.convertedCustomerId && <button className="btn btn-sm" onClick={() => { setCustomerEditRequest && setCustomerEditRequest(selectedImport.convertedCustomerId); setActiveTab && setActiveTab('database'); }}>Open Customer</button>}
                  {selectedImport.convertedJobId && <button className="btn btn-sm" onClick={() => setActiveTab && setActiveTab('jobs')}>Open Jobs</button>}
                </div>
              </div>

              <div className="note" style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Lead Snapshot</div>
                <div className="row" style={{ marginBottom: 0 }}>
                  <div>
                    <div className="small">Contact</div>
                    <div>{[leadSummary?.phone, leadSummary?.email].filter(Boolean).join(' | ') || 'No contact info'}</div>
                  </div>
                  <div>
                    <div className="small">Service Address</div>
                    <div>{leadSummary?.address || 'No address supplied'}</div>
                  </div>
                </div>
                <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
                  <div>
                    <div className="small">Requested Service</div>
                    <div>{leadSummary?.serviceCategory || 'General inquiry'}</div>
                  </div>
                  <div>
                    <div className="small">Estimate / Frequency</div>
                    <div>{leadSummary?.estimateTotal > 0 ? `${money(leadSummary.estimateTotal)} | ` : ''}{leadSummary?.frequency || 'No frequency supplied'}</div>
                  </div>
                </div>
                {leadSummary?.notes && <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{leadSummary.notes}</div>}
              </div>

              {selectedImport.intakeStatus === 'converted' ? (
                <div className="card" style={{ margin: 0, borderColor: 'var(--accent)', background: 'rgba(110,168,254,0.08)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Conversion Complete</div>
                  <div className="small">Customer ID: {selectedImport.convertedCustomerId || 'n/a'}</div>
                  <div className="small">Estimate Job ID: {selectedImport.convertedJobId || 'none created'}</div>
                  <div className="small">Converted: {formatTimestamp(selectedImport.convertedAt)}</div>
                </div>
              ) : (
                <div className="card" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>Customer Match Review</h3>
                    <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={createEstimateJob} onChange={e => setCreateEstimateJob(e.target.checked)} />
                      Create estimate job in Service Jobs
                    </label>
                  </div>

                  {candidateList.length === 0 ? (
                    <div style={{ color: 'var(--muted)' }}>No likely customer matches found. Creating a new lead is safe.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {candidateList.map(candidate => (
                        <div key={candidate.id} className="note" style={{ marginTop: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontWeight: 700 }}>{candidate.name} <span className="small">#{String(candidate.customerNumber ?? '?').padStart(4, '0')}</span></div>
                              <div className="small">{candidate.address || candidate.phone || 'No address or phone on file'}</div>
                              <div className="small" style={{ marginTop: 4 }}>{candidate.confidence} | score {candidate.score} | {candidate.reasons.join(', ')}</div>
                            </div>
                            <button className="btn btn-accent btn-sm" disabled={converting} onClick={() => { setLinkCustomerId(candidate.id); handleConvert({ action: 'link_existing', existingCustomerId: candidate.id }); }}>
                              Link {createEstimateJob ? '+ Estimate' : 'Only'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: 16 }}>
                    <label>Link To Another Existing Customer</label>
                    <div className="flex-row">
                      <select value={linkCustomerId} onChange={e => setLinkCustomerId(e.target.value)} style={{ minWidth: 280 }}>
                        <option value="">Select customer...</option>
                        {sortedCustomers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.address ? ` - ${customer.address}` : ''}</option>)}
                      </select>
                      <button className="btn btn-sm" disabled={!linkCustomerId || converting} onClick={() => handleConvert({ action: 'link_existing', existingCustomerId: linkCustomerId })}>Link Selected</button>
                    </div>
                  </div>

                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Create New Lead</div>
                    {blockNewCustomer && (
                      <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--warn)' }}>
                        <input type="checkbox" checked={forceNewCustomer} onChange={e => setForceNewCustomer(e.target.checked)} />
                        I reviewed the exact-match warnings above and still want to create a new lead.
                      </label>
                    )}
                    <div className="flex-row">
                      <button className="btn btn-accent" disabled={converting || (blockNewCustomer && !forceNewCustomer)} onClick={() => handleConvert({ action: 'create_new' })}>
                        Create {createEstimateJob ? 'Lead + Estimate' : 'Lead Only'}
                      </button>
                      <button className="btn btn-sm" disabled={converting} onClick={handleMarkReviewed}>Mark Reviewed</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// â”€â”€â”€ MAP TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function MapTab({ customers, setCustomers, serviceJobs, mapFocus, setMapFocus, openCustomerEditor }) {
  const [mapFilter, setMapFilter] = useState("active");
  const [geoCache, setGeoCache] = useState({});
  const [geoPendingCount, setGeoPendingCount] = useState(0);
  const [routeState, setRouteState] = useState({ status: "idle", distanceKm: 0, durationMin: 0, error: "" });
  const [requestError, setRequestError] = useState("");
  const [showMapPanel, setShowMapPanel] = useState(false);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const mapHostRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markerLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const todayKey = useMemo(() => toLocalISODate(), []);

  const customerById = useMemo(() => { const m = new Map(); (customers || []).forEach(c => m.set(String(c.id), c)); return m; }, [customers]);

  const todayRouteCustomerIds = useMemo(() => {
    const ids = []; const seen = new Set();
    (serviceJobs || []).filter(j => j && j.scheduledDate === todayKey && j.status !== "Cancelled").forEach(j => {
      const id = String(j.customerId || "");
      if (!id || seen.has(id)) return; seen.add(id); ids.push(id);
    });
    return ids;
  }, [serviceJobs, todayKey]);

  const baseCustomers = useMemo(() => {
    if (mapFilter === "today") return todayRouteCustomerIds.map(id => customerById.get(id)).filter(Boolean);
    if (mapFilter === "leads") return (customers || []).filter(c => String(c.status).toLowerCase() === "lead");
    return (customers || []).filter(c => String(c.status).toLowerCase() === "active");
  }, [mapFilter, todayRouteCustomerIds, customerById, customers]);

  const filteredCustomers = useMemo(() => {
    const list = baseCustomers.filter(c => c && c.address && String(c.address).trim());
    if (mapFocus?.address && mapFilter !== "today") {
      const fk = addressKey(mapFocus.address);
      if (!list.some(c => addressKey(c.address) === fk)) list.push({ id: `focus:${fk}`, name: mapFocus.name || "Focused", address: mapFocus.address, status: "Focused", markerEmoji: mapFocus.markerEmoji || '' });
    }
    return list;
  }, [baseCustomers, mapFocus, mapFilter]);

  const todayRouteStops = useMemo(() => todayRouteCustomerIds.map(id => customerById.get(id)).filter(c => c && c.address), [todayRouteCustomerIds, customerById]);

  const mapsSearchUrl = mapFocus?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapFocus.address)}` : null;
  const mapsDirectionsUrl = useMemo(() => {
    if (todayRouteStops.length < 2) return null;
    const waypoints = todayRouteStops.slice(1, -1).map(s => s.address).join("|");
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(todayRouteStops[0].address)}&destination=${encodeURIComponent(todayRouteStops[todayRouteStops.length - 1].address)}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}&travelmode=driving`;
  }, [todayRouteStops]);

  // Geocoding
  useEffect(() => {
    const missing = filteredCustomers.filter(c => (c.lat == null || c.lng == null) && c.address && !hasOwn(geoCache, addressKey(c.address)));
    if (!missing.length) { setGeoPendingCount(0); return; }
    let cancelled = false;
    setGeoPendingCount(missing.length);
    setRequestError("");
    (async () => {
      for (const customer of missing) {
        if (cancelled) return;
        const key = addressKey(customer.address);
        let val = { notFound: true };
        try {
          const data = await apiFetch(`/api/geocode?address=${encodeURIComponent(customer.address)}`);
          if (data?.lat && data?.lng) {
            val = { lat: Number(data.lat), lng: Number(data.lng) };
            if (customer.id && !String(customer.id).startsWith('focus:')) {
              const updated = { ...customer, ...val };
              setCustomers(p => p.map(c => String(c.id) === String(customer.id) ? updated : c));
              apiSync(`/api/v1/customers/${customer.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
            }
          }
        } catch (err) {
          // "Failed to fetch" = no backend running â€” suppress silently.
          // Any other error (4xx, 5xx, etc.) is a real geocoding problem worth showing.
          const isNetworkError = err instanceof TypeError && err.message === "Failed to fetch";
          if (!cancelled && !isNetworkError) setRequestError(`Geocoding failed for "${customer.name}": ${err?.message || "unknown error"}`);
        }
        if (!cancelled) {
          setGeoCache(p => hasOwn(p, key) ? p : { ...p, [key]: val });
          setGeoPendingCount(p => Math.max(0, p - 1));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [filteredCustomers, geoCache, setCustomers]);

  const geocodedCustomers = useMemo(() => filteredCustomers.map(c => {
    if (c.lat != null && c.lng != null) return { ...c, coords: { lat: Number(c.lat), lng: Number(c.lng) } };
    const cached = geoCache[addressKey(c.address)];
    return { ...c, coords: (!cached || cached.notFound) ? null : { lat: Number(cached.lat), lng: Number(cached.lng) } };
  }), [filteredCustomers, geoCache]);

  const pinnedCustomers = useMemo(() => geocodedCustomers.filter(c => c.coords), [geocodedCustomers]);
  const unresolvedCustomers = useMemo(() => geocodedCustomers.filter(c => !c.coords), [geocodedCustomers]);

  const todayRouteCustomers = useMemo(() => {
    if (mapFilter !== "today") return [];
    return todayRouteCustomerIds.map(id => geocodedCustomers.find(c => String(c.id) === id && c.coords)).filter(Boolean);
  }, [mapFilter, todayRouteCustomerIds, geocodedCustomers]);

  const todayRouteIndexByCustomerId = useMemo(() => { const m = new Map(); todayRouteCustomerIds.forEach((id, i) => m.set(String(id), i + 1)); return m; }, [todayRouteCustomerIds]);

  // Init Leaflet map
  useEffect(() => {
    if (!mapHostRef.current || typeof window.L === "undefined" || leafletMapRef.current) return;
    const map = window.L.map(mapHostRef.current, { zoomControl: true });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    map.setView([39.8283, -98.5795], 4);
    markerLayerRef.current = window.L.layerGroup().addTo(map);
    routeLayerRef.current = window.L.layerGroup().addTo(map);
    leafletMapRef.current = map;
    return () => { map.remove(); leafletMapRef.current = null; };
  }, []);

  // Update markers
  useEffect(() => {
    const map = leafletMapRef.current; const layer = markerLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds = [];
    pinnedCustomers.forEach(c => {
      const stopNum = todayRouteIndexByCustomerId.get(String(c.id));
      const markerEmoji = normalizeMarkerEmoji(c.markerEmoji);
      const popup = `<strong>${markerEmoji ? `${escapeHtml(markerEmoji)} ` : ''}${escapeHtml(c.name)}</strong><br/>${escapeHtml(c.address)}<br/>${escapeHtml(c.status || "")}${(mapFilter === "today" && stopNum) ? `<br/>Stop ${stopNum}` : ""}`;
      const markerIcon = buildCustomerMarkerIcon(markerEmoji);
      const marker = markerIcon ? window.L.marker([c.coords.lat, c.coords.lng], { icon: markerIcon }) : window.L.marker([c.coords.lat, c.coords.lng]);
      marker.bindPopup(popup);
      marker.on("click", () => setMapFocus({ name: c.name, address: c.address, markerEmoji }));
      marker.addTo(layer);
      bounds.push([c.coords.lat, c.coords.lng]);
    });
    if (mapFocus?.address) {
      const pin = pinnedCustomers.find(c => addressKey(c.address) === addressKey(mapFocus.address));
      if (pin) { map.setView([pin.coords.lat, pin.coords.lng], 13); return; }
    }
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    else map.setView([39.8283, -98.5795], 4);
  }, [pinnedCustomers, mapFocus, mapFilter, setMapFocus, todayRouteIndexByCustomerId]);

  // Route drawing
  useEffect(() => {
    const layer = routeLayerRef.current; if (!layer) return;
    layer.clearLayers();
    if (mapFilter !== "today") { setRouteState({ status: "idle", distanceKm: 0, durationMin: 0, error: "" }); return; }
    if (todayRouteCustomers.length < 2) { setRouteState({ status: "insufficient", distanceKm: 0, durationMin: 0, error: "" }); return; }
    let cancelled = false;
    setRouteState({ status: "loading", distanceKm: 0, durationMin: 0, error: "" });
    (async () => {
      const coordStr = todayRouteCustomers.map(c => `${c.coords.lng},${c.coords.lat}`).join(";");
      try {
        const data = await apiFetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);
        if (cancelled) return;
        const route = data?.routes?.[0];
        if (!route?.geometry?.coordinates?.length) throw new Error("No driving route found.");
        const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const poly = window.L.polyline(latLngs, { color: "#6ea8fe", weight: 5, opacity: 0.92 }).addTo(layer);
        const map = leafletMapRef.current;
        if (map) map.fitBounds(poly.getBounds(), { padding: [48, 48], maxZoom: 13 });
        setRouteState({ status: "ready", distanceKm: route.distance / 1000, durationMin: route.duration / 60, error: "" });
      } catch (err) {
        const isNetworkError = err instanceof TypeError && err.message === "Failed to fetch";
        if (!cancelled) setRouteState({ status: "error", distanceKm: 0, durationMin: 0, error: isNetworkError ? "Routing service unreachable." : (err?.message || "Unable to calculate route.") });
      }
    })();
    return () => { cancelled = true; };
  }, [mapFilter, todayRouteCustomers]);

  return (
    <div>
      <div className="title-row">
        <div><div className="pill">Logistics Module</div><h2>Customer Map</h2><div className="sub">Live customer geocoding, marker placement, and route previews.</div></div>
        <select style={{ width: "220px" }} value={mapFilter} onChange={e => setMapFilter(e.target.value)}>
          <option value="active">All Active Customers</option>
          <option value="today">Today's Route</option>
          <option value="leads">Leads Only</option>
        </select>
      </div>

      {mapFocus && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '14px 18px', marginBottom: 16, background: 'rgba(110,168,254,0.08)', border: '1px solid var(--accent)', borderRadius: '14px' }}>
          <div><div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700, marginBottom: 2 }}>Focused: {mapFocus.markerEmoji ? `${mapFocus.markerEmoji} ` : ''}{mapFocus.name}</div><div style={{ fontSize: 14 }}>{mapFocus.address}</div></div>
          <div className="flex-row">
            {mapsSearchUrl && <a href={mapsSearchUrl} target="_blank" rel="noopener noreferrer" className="btn btn-accent btn-sm" style={{ textDecoration: 'none' }}>Open in Google Maps</a>}
            <button className="btn btn-sm" onClick={() => setMapFocus(null)}>Clear Focus</button>
          </div>
        </div>
      )}

      {requestError && <div className="alert">{requestError}</div>}

      <div className="card">
        <div className="mock-api-container">
          <div ref={mapHostRef} className="leaflet-host" />
          <button className="btn btn-sm" style={{ position: 'absolute', top: 12, right: 12, zIndex: 3 }} onClick={() => setShowMapPanel(v => !v)}>{showMapPanel ? "Hide Map Info" : "Show Map Info"}</button>
          {showMapPanel && (
            <div className="mock-api-overlay" style={{ top: 56, right: 12, left: 'auto', transform: 'none', width: 'min(92%,420px)', maxHeight: '70%', overflowY: 'auto' }}>
              <h3 style={{ margin: 0 }}>Map + Routing Connected</h3>
              <p style={{ margin: '8px 0 0 0', fontSize: 14 }}>OpenStreetMap + Leaflet. Customer pins are geocoded from CRM addresses.</p>
              <div className="route-summary">
                <span className="badge">Visible: {filteredCustomers.length}</span>
                <span className="badge badge-good">Pinned: {pinnedCustomers.length}</span>
                {unresolvedCustomers.length > 0 ? <span className="badge badge-warn" style={{ cursor: 'pointer' }} onClick={() => setShowUnresolved(v => !v)}>Unresolved: {unresolvedCustomers.length} {showUnresolved ? 'â–²' : 'â–¼'}</span> : <span className="badge badge-good">Unresolved: 0</span>}
                {geoPendingCount > 0 && <span className="badge">Geocoding: {geoPendingCount}â€¦</span>}
              </div>
              {mapFilter === "today" && (
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
                  <div>Route date: {todayKey}</div>
                  <div>Stops: {todayRouteStops.length}</div>
                  {routeState.status === "loading" && <div style={{ color: 'var(--text)' }}>Calculating routeâ€¦</div>}
                  {routeState.status === "ready" && <div style={{ color: 'var(--text)' }}>Distance: {routeState.distanceKm.toFixed(1)} km | ETA: {Math.round(routeState.durationMin)} min</div>}
                  {routeState.status === "insufficient" && <div>Need at least 2 geocoded stops to build a route.</div>}
                  {routeState.status === "error" && <div style={{ color: 'var(--danger)' }}>{routeState.error}</div>}
                  {mapsDirectionsUrl && <div style={{ marginTop: 8 }}><a href={mapsDirectionsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-accent" style={{ textDecoration: 'none' }}>Open Route in Google Maps</a></div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showUnresolved && unresolvedCustomers.length > 0 && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--warn)' }}>
          <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--warn)' }}>Unresolved Addresses â€” fix these to place them on the map</div>
          <table>
            <thead><tr><th>Customer</th><th>Address on file</th><th>Actions</th></tr></thead>
            <tbody>
              {unresolvedCustomers.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ color: 'var(--danger)' }}>{c.address || <em style={{ color: 'var(--muted)' }}>No address</em>}</td>
                  <td><button className="btn btn-sm" onClick={() => openCustomerEditor && openCustomerEditor(c)} disabled={!c.id || String(c.id).startsWith('focus:')}>Edit Customer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ CALENDAR TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CALENDAR_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CALENDAR_SLOT_DEFINITIONS = {
  morning: {
    label: '8 AM - 12 PM',
    slotBackground: 'rgba(250, 204, 21, 0.18)',
    slotBorder: 'rgba(161, 98, 7, 0.26)',
    eventBackground: '#b98906',
  },
  afternoon: {
    label: '12 PM - 4 PM',
    slotBackground: 'rgba(74, 222, 128, 0.18)',
    slotBorder: 'rgba(21, 128, 61, 0.22)',
    eventBackground: '#1f7a41',
  },
};
function parseCalendarEventDateTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function getCalendarEventDateKey(event) {
  if (event?.start?.date) return String(event.start.date || '').trim();
  const parsed = parseCalendarEventDateTime(event?.start?.dateTime);
  if (parsed) return toLocalISODate(parsed);
  const fallback = String(event?.start?.dateTime || '').trim();
  return fallback ? fallback.slice(0, 10) : '';
}
function getCalendarEventSortValue(event) {
  if (event?.start?.date) {
    const parsed = new Date(`${event.start.date}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime();
  }
  const parsed = parseCalendarEventDateTime(event?.start?.dateTime);
  return parsed ? parsed.getTime() : Number.MAX_SAFE_INTEGER;
}
function getCalendarEventMinutesSinceMidnight(dateValue) {
  return (dateValue.getHours() * 60) + dateValue.getMinutes();
}
function getCalendarOverlapMinutes(startMinutes, endMinutes, rangeStartMinutes, rangeEndMinutes) {
  return Math.max(0, Math.min(endMinutes, rangeEndMinutes) - Math.max(startMinutes, rangeStartMinutes));
}
function getCalendarEventSlotKey(event) {
  if (event?.start?.date && !event?.start?.dateTime) return 'morning';
  const start = parseCalendarEventDateTime(event?.start?.dateTime);
  if (!start) return 'other';
  const parsedEnd = parseCalendarEventDateTime(event?.end?.dateTime);
  const end = parsedEnd && parsedEnd.getTime() > start.getTime()
    ? parsedEnd
    : new Date(start.getTime() + (60 * 60 * 1000));
  const startMinutes = getCalendarEventMinutesSinceMidnight(start);
  const endMinutes = Math.max(startMinutes + 30, getCalendarEventMinutesSinceMidnight(end));
  const morningOverlap = getCalendarOverlapMinutes(startMinutes, endMinutes, 8 * 60, 12 * 60);
  const afternoonOverlap = getCalendarOverlapMinutes(startMinutes, endMinutes, 12 * 60, 16 * 60);
  if (!morningOverlap && !afternoonOverlap) return 'other';
  return morningOverlap >= afternoonOverlap ? 'morning' : 'afternoon';
}
function formatCalendarEventTimeLabel(event) {
  if (event?.start?.date && !event?.start?.dateTime) return 'All day';
  const start = parseCalendarEventDateTime(event?.start?.dateTime);
  if (!start) return 'Time TBD';
  const fmt = value => value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const end = parseCalendarEventDateTime(event?.end?.dateTime);
  if (end && end.getTime() > start.getTime()) return `${fmt(start)} - ${fmt(end)}`;
  return fmt(start);
}
function splitCalendarEventSummary(summary = '') {
  const clean = String(summary || '').trim();
  if (!clean) return { serviceLabel: '', customerName: '' };
  if (/^callback:/i.test(clean)) {
    return { serviceLabel: 'Callback', customerName: clean.replace(/^callback:\s*/i, '').trim() };
  }
  const parts = clean.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      serviceLabel: parts[0],
      customerName: parts.slice(1).join(' - '),
    };
  }
  return { serviceLabel: clean, customerName: '' };
}
function hexToRgb(hexColor) {
  const normalized = String(hexColor || '').trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}
function getContrastTextColor(hexColor) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return '#102030';
  const brightness = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
  return brightness > 150 ? '#102030' : '#ffffff';
}

function CalendarTabLegacyUnused({ calAuth, navigateTo, customers = [], serviceJobs = [] }) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [gcalEvents, setGcalEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!calAuth) {
      setGcalEvents([]);
      setLoading(false);
      setSelectedEvent(null);
      return;
    }
    setLoading(true); setError("");
    apiFetch('/api/calendar/events')
      .then(data => { setGcalEvents(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { setError(err?.message || "Failed to load calendar events."); setLoading(false); });
  }, [calAuth]);
  useEffect(() => {
    if (!selectedEvent) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') setSelectedEvent(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEvent]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
  const todayStr = toLocalISODate(today);
  const customerById = useMemo(() => {
    const next = new Map();
    (customers || []).forEach(customer => next.set(String(customer.id), customer));
    return next;
  }, [customers]);
  const jobByEventId = useMemo(() => {
    const next = new Map();
    (serviceJobs || []).forEach(job => {
      const eventId = String(job?.gcalEventId || '').trim();
      if (eventId) next.set(eventId, job);
    });
    return next;
  }, [serviceJobs]);
  const eventsByDate = useMemo(() => {
    const next = {};
    (gcalEvents || []).forEach(ev => {
      const dateKey = getCalendarEventDateKey(ev);
      if (!dateKey) return;
      const linkedJob = jobByEventId.get(String(ev?.id || '').trim()) || null;
      const linkedCustomer = linkedJob ? (customerById.get(String(linkedJob.customerId || '')) || null) : null;
      const parsedSummary = splitCalendarEventSummary(ev?.summary || '');
      const serviceLabel = linkedJob?.serviceType || parsedSummary.serviceLabel || String(ev?.summary || 'Calendar Event').trim();
      const customerName = linkedCustomer?.name || parsedSummary.customerName || '';
      const detail = {
        id: String(ev?.id || `${dateKey}-${serviceLabel}-${customerName}`),
        summary: String(ev?.summary || serviceLabel || 'Calendar Event').trim(),
        serviceLabel,
        customerName,
        timeLabel: formatCalendarEventTimeLabel(ev),
        slotKey: getCalendarEventSlotKey(ev),
        dateKey,
        sortValue: getCalendarEventSortValue(ev),
        location: String(ev?.location || linkedJob?.address || linkedCustomer?.address || '').trim(),
        notes: String(ev?.description || linkedJob?.notes || '').trim(),
        phone: String(linkedCustomer?.phone || '').trim(),
        email: String(linkedCustomer?.email || '').trim(),
        status: String(linkedJob?.status || '').trim(),
        jobNumber: linkedJob?.jobNumber || '',
        linkedJob,
        linkedCustomer,
      };
      if (!next[dateKey]) next[dateKey] = [];
      next[dateKey].push(detail);
    });
    Object.values(next).forEach(items => items.sort((a, b) => a.sortValue - b.sortValue || a.summary.localeCompare(b.summary)));
    return next;
  }, [customerById, gcalEvents, jobByEventId]);

  const cells = Array.from({ length: firstDayOfWeek }, () => null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));
  while (cells.length % 7 !== 0) cells.push(null);
  const selectedEventPhoneLink = String(selectedEvent?.phone || '').replace(/[^\d+]/g, '');
  const renderSlot = (slotKey, events) => {
    const theme = CALENDAR_SLOT_DEFINITIONS[slotKey];
    const textColor = getContrastTextColor(theme.eventBackground);
    const visibleEvents = events.slice(0, 2);
    return (
      <div
        style={{
          position: 'relative',
          minHeight: 0,
          borderRadius: 10,
          background: theme.slotBackground,
          border: `1px solid ${theme.slotBorder}`,
          padding: '20px 6px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: 5, left: 7, fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(16,24,40,0.72)', fontWeight: 800 }}>
          {theme.label}
        </div>
        {visibleEvents.map(event => (
          <button
            key={event.id}
            type="button"
            onClick={() => setSelectedEvent(event)}
            title={[event.summary, event.timeLabel, event.customerName, event.location].filter(Boolean).join('\n')}
            style={{
              width: '100%',
              border: '1px solid rgba(15, 23, 42, 0.16)',
              borderRadius: 7,
              padding: '4px 6px',
              background: theme.eventBackground,
              color: textColor,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1.25,
              textAlign: 'left',
              cursor: 'pointer',
              boxShadow: '0 3px 8px rgba(15, 23, 42, 0.12)',
              overflow: 'hidden',
            }}
          >
            <div style={{ fontSize: 9, opacity: 0.8, marginBottom: 1 }}>{event.timeLabel}</div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {event.customerName || event.summary}
            </div>
          </button>
        ))}
        {events.length > 2 && <div style={{ fontSize: 10, color: 'rgba(16,24,40,0.72)', fontWeight: 700 }}>+{events.length - 2} more</div>}
      </div>
    );
  };

  return (
    <div>
      <div className="title-row">
        <div><div className="pill">Scheduling Module</div><h2>Dispatch Calendar</h2><div className="sub">Pulls live events from Google Calendar.</div></div>
        <div className="flex-row">
          {calAuth
            ? <span style={{ color: 'var(--good)', fontSize: 14, fontWeight: 600 }}>â— G-Cal Connected</span>
            : <span style={{ color: 'var(--warn)', fontSize: 14, fontWeight: 600 }}>Google Calendar not connected</span>}
          {navigateTo && (
            <button className="btn btn-sm" onClick={() => navigateTo('settings', 'general')}>
              {calAuth ? 'Manage in Settings' : 'Open Google Settings'}
            </button>
          )}
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="btn btn-sm" onClick={prevMonth}>â€¹ Prev</button>
          <span style={{ fontWeight: 600, fontSize: 16, minWidth: 140, textAlign: 'center' }}>{monthName} {year}</span>
          <button className="btn btn-sm" onClick={nextMonth}>Next â€º</button>
          {loading && <span style={{ color: 'var(--muted)', fontSize: 13 }}>Loadingâ€¦</span>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {Object.entries(CALENDAR_SLOT_DEFINITIONS).map(([slotKey, theme]) => (
            <div key={slotKey} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: theme.slotBackground, border: `1px solid ${theme.slotBorder}`, fontSize: 12, fontWeight: 700 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: theme.eventBackground, display: 'inline-block' }} />
              {theme.label}
            </div>
          ))}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: 'var(--panel-soft)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
            Off-hour events stay in the day header.
          </div>
        </div>
        <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(118px,1fr))', gap: '8px', minWidth: 860 }}>
            {CALENDAR_DAY_NAMES.map(d => <div key={d} style={{ fontWeight: 600, color: 'var(--muted)', padding: '6px 0', textAlign: 'center', fontSize: 13 }}>{d}</div>)}
            {cells.map((day, i) => {
              const dateStr = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
              const isToday = dateStr === todayStr;
              const events = dateStr ? (eventsByDate[dateStr] || []) : [];
              const slotBuckets = { morning: [], afternoon: [], other: [] };
              events.forEach(event => slotBuckets[event.slotKey]?.push(event));
              const otherEventsTitle = slotBuckets.other.map(event => `${event.timeLabel} - ${event.summary}`).join('\n');
              if (!day) {
                return <div key={i} style={{ background: 'var(--panel-soft)', border: '1px solid var(--border)', borderRadius: 12, minHeight: 220, opacity: 0.14 }} />;
              }
              return (
                <div key={i} style={{ background: isToday ? 'rgba(110,168,254,0.08)' : 'var(--panel-soft)', border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, minHeight: 220, padding: 8, display: 'flex', flexDirection: 'column', boxShadow: isToday ? '0 0 0 1px rgba(110,168,254,0.12)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, color: isToday ? 'var(--accent)' : 'var(--muted)', fontWeight: isToday ? 800 : 600 }}>{day}</div>
                    {slotBuckets.other.length > 0 && (
                      <span title={otherEventsTitle} style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, border: '1px solid var(--border)', background: 'var(--panel)', borderRadius: 999, padding: '3px 7px' }}>
                        +{slotBuckets.other.length} off-hours
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateRows: 'repeat(4, minmax(0, 1fr))', gap: 6, flex: 1 }}>
                    <div style={{ borderRadius: 10, background: 'transparent' }} />
                    {renderSlot('morning', slotBuckets.morning)}
                    {renderSlot('afternoon', slotBuckets.afternoon)}
                    <div style={{ borderRadius: 10, background: 'transparent' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {!calAuth && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 14 }}>
            <div>Google Calendar connection is managed in Settings &gt; General.</div>
            {navigateTo && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-accent" onClick={() => navigateTo('settings', 'general')}>Open Google Settings</button>
              </div>
            )}
          </div>
        )}
        {calAuth && !loading && !gcalEvents.length && (
          <div style={{ marginTop: 14, color: 'var(--muted)', fontSize: 13 }}>
            No upcoming Google Calendar events were returned for this account.
          </div>
        )}
      </div>
      {selectedEvent && (
        <div className="modal-overlay" style={{ alignItems: 'center', padding: 16 }} onClick={event => { if (event.target === event.currentTarget) setSelectedEvent(null); }}>
          <div className="modal" style={{ width: 'min(560px, calc(100vw - 32px))', maxWidth: 560, margin: 0 }} onClick={event => event.stopPropagation()}>
            <div className="title-row" style={{ marginBottom: 18 }}>
              <div>
                <div className="pill">Calendar Event</div>
                <h2 style={{ marginBottom: 6 }}>{selectedEvent.customerName || selectedEvent.summary}</h2>
                <div className="sub">{selectedEvent.serviceLabel || selectedEvent.summary}</div>
              </div>
              <button className="btn btn-sm" onClick={() => setSelectedEvent(null)}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>When</div>
                <div style={{ fontWeight: 700 }}>{selectedEvent.dateKey}</div>
                <div style={{ marginTop: 4 }}>{selectedEvent.timeLabel}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>CRM Link</div>
                <div style={{ fontWeight: 700 }}>{selectedEvent.linkedJob ? 'Linked to service job' : 'Google event only'}</div>
                <div style={{ marginTop: 4 }}>
                  {selectedEvent.linkedJob
                    ? `Job #${selectedEvent.jobNumber || selectedEvent.linkedJob.id}${selectedEvent.status ? ` â€¢ ${selectedEvent.status}` : ''}`
                    : 'No matching CRM job record found'}
                </div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>Customer</div>
                <div style={{ fontWeight: 700 }}>{selectedEvent.customerName || 'Not identified from CRM'}</div>
                <div style={{ marginTop: 4 }}>{selectedEvent.phone || 'No phone on linked customer'}</div>
                <div style={{ marginTop: 2, wordBreak: 'break-word' }}>{selectedEvent.email || 'No email on linked customer'}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>Location</div>
                <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{selectedEvent.location || 'No location provided'}</div>
              </div>
            </div>
            {selectedEvent.notes && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)', marginTop: 12 }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 6 }}>Notes</div>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{selectedEvent.notes}</div>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {selectedEventPhoneLink && <a className="btn btn-sm" href={`tel:${selectedEventPhoneLink}`}>Call</a>}
              {selectedEvent.email && <a className="btn btn-sm" href={`mailto:${selectedEvent.email}`}>Email</a>}
              {selectedEvent.location && <a className="btn btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedEvent.location)}`} target="_blank" rel="noopener noreferrer">Map</a>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ LEGAL PAGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CalendarTab({ calAuth, navigateTo, customers = [], serviceJobs = [] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [gcalEvents, setGcalEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    if (!calAuth) {
      setGcalEvents([]);
      setLoading(false);
      setSelectedEvent(null);
      return;
    }
    setLoading(true);
    setError("");
    apiFetch('/api/calendar/events')
      .then(data => { setGcalEvents(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { setError(err?.message || "Failed to load calendar events."); setLoading(false); });
  }, [calAuth]);
  useEffect(() => {
    if (!selectedEvent) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') setSelectedEvent(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEvent]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month).toLocaleString('default', { month: 'long' });
  const todayStr = toLocalISODate(today);
  const customerById = useMemo(() => {
    const next = new Map();
    (customers || []).forEach(customer => next.set(String(customer.id), customer));
    return next;
  }, [customers]);
  const jobByEventId = useMemo(() => {
    const next = new Map();
    (serviceJobs || []).forEach(job => {
      const eventId = String(job?.gcalEventId || '').trim();
      if (eventId) next.set(eventId, job);
    });
    return next;
  }, [serviceJobs]);
  const eventsByDate = useMemo(() => {
    const next = {};
    (gcalEvents || []).forEach(ev => {
      const dateKey = getCalendarEventDateKey(ev);
      if (!dateKey) return;
      const linkedJob = jobByEventId.get(String(ev?.id || '').trim()) || null;
      const linkedCustomer = linkedJob ? (customerById.get(String(linkedJob.customerId || '')) || null) : null;
      const parsedSummary = splitCalendarEventSummary(ev?.summary || '');
      const serviceLabel = linkedJob?.serviceType || parsedSummary.serviceLabel || String(ev?.summary || 'Calendar Event').trim();
      const customerName = linkedCustomer?.name || parsedSummary.customerName || '';
      const detail = {
        id: String(ev?.id || `${dateKey}-${serviceLabel}-${customerName}`),
        summary: String(ev?.summary || serviceLabel || 'Calendar Event').trim(),
        serviceLabel,
        customerName,
        timeLabel: formatCalendarEventTimeLabel(ev),
        slotKey: getCalendarEventSlotKey(ev),
        dateKey,
        sortValue: getCalendarEventSortValue(ev),
        location: String(ev?.location || linkedJob?.address || linkedCustomer?.address || '').trim(),
        notes: String(ev?.description || linkedJob?.notes || '').trim(),
        phone: String(linkedCustomer?.phone || '').trim(),
        email: String(linkedCustomer?.email || '').trim(),
        status: String(linkedJob?.status || '').trim(),
        jobNumber: linkedJob?.jobNumber || '',
        linkedJob,
        linkedCustomer,
      };
      if (!next[dateKey]) next[dateKey] = [];
      next[dateKey].push(detail);
    });
    Object.values(next).forEach(items => items.sort((a, b) => a.sortValue - b.sortValue || a.summary.localeCompare(b.summary)));
    return next;
  }, [customerById, gcalEvents, jobByEventId]);

  const cells = Array.from({ length: firstDayOfWeek }, () => null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));
  while (cells.length % 7 !== 0) cells.push(null);
  const selectedEventPhoneLink = String(selectedEvent?.phone || '').replace(/[^\d+]/g, '');
  const renderSlot = (slotKey, events) => {
    const theme = CALENDAR_SLOT_DEFINITIONS[slotKey];
    const textColor = getContrastTextColor(theme.eventBackground);
    const visibleEvents = events.slice(0, 2);
    return (
      <div
        style={{
          position: 'relative',
          minHeight: 0,
          borderRadius: 10,
          background: theme.slotBackground,
          border: `1px solid ${theme.slotBorder}`,
          padding: '20px 6px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', top: 5, left: 7, fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(16,24,40,0.72)', fontWeight: 800 }}>
          {theme.label}
        </div>
        {visibleEvents.map(event => (
          <button
            key={event.id}
            type="button"
            onClick={() => setSelectedEvent(event)}
            title={[event.summary, event.timeLabel, event.customerName, event.location].filter(Boolean).join('\n')}
            style={{
              width: '100%',
              border: '1px solid rgba(15, 23, 42, 0.16)',
              borderRadius: 7,
              padding: '4px 6px',
              background: theme.eventBackground,
              color: textColor,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1.25,
              textAlign: 'left',
              cursor: 'pointer',
              boxShadow: '0 3px 8px rgba(15, 23, 42, 0.12)',
              overflow: 'hidden',
            }}
          >
            <div style={{ fontSize: 9, opacity: 0.8, marginBottom: 1 }}>{event.timeLabel}</div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {event.customerName || event.summary}
            </div>
          </button>
        ))}
        {events.length > 2 && <div style={{ fontSize: 10, color: 'rgba(16,24,40,0.72)', fontWeight: 700 }}>+{events.length - 2} more</div>}
      </div>
    );
  };

  return (
    <div>
      <div className="title-row">
        <div><div className="pill">Scheduling Module</div><h2>Dispatch Calendar</h2><div className="sub">Pulls live events from Google Calendar.</div></div>
        <div className="flex-row">
          {calAuth
            ? <span style={{ color: 'var(--good)', fontSize: 14, fontWeight: 600 }}>â— G-Cal Connected</span>
            : <span style={{ color: 'var(--warn)', fontSize: 14, fontWeight: 600 }}>Google Calendar not connected</span>}
          {navigateTo && (
            <button className="btn btn-sm" onClick={() => navigateTo('settings', 'general')}>
              {calAuth ? 'Manage in Settings' : 'Open Google Settings'}
            </button>
          )}
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button className="btn btn-sm" onClick={prevMonth}>â€¹ Prev</button>
          <span style={{ fontWeight: 600, fontSize: 16, minWidth: 140, textAlign: 'center' }}>{monthName} {year}</span>
          <button className="btn btn-sm" onClick={nextMonth}>Next â€º</button>
          {loading && <span style={{ color: 'var(--muted)', fontSize: 13 }}>Loadingâ€¦</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: '6px' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} style={{ fontWeight: 600, color: 'var(--muted)', padding: '6px 0', textAlign: 'center', fontSize: 13 }}>{d}</div>)}
          {cells.map((day, i) => {
            const dateStr = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
            const isToday = dateStr === todayStr;
            const events = dateStr ? (eventsByDate[dateStr] || []) : [];
            return (
              <div key={i} style={{ background: isToday ? 'rgba(110,168,254,0.1)' : 'var(--panel-soft)', border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, minHeight: 80, padding: 6, opacity: day ? 1 : 0.15 }}>
                {day && <div style={{ fontSize: 12, color: isToday ? 'var(--accent)' : 'var(--muted)', fontWeight: isToday ? 700 : 400, marginBottom: 4 }}>{day}</div>}
                {events.slice(0, 3).map((ev, j) => <div key={j} title={ev.summary} style={{ background: 'var(--accent)', color: '#000', fontSize: 10, padding: '2px 4px', borderRadius: 3, marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 600 }}>{ev.summary}</div>)}
                {events.length > 3 && <div style={{ fontSize: 10, color: 'var(--muted)' }}>+{events.length - 3} more</div>}
              </div>
            );
          })}
        </div>
        {!calAuth && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 14 }}>
            <div>Google Calendar connection is managed in Settings &gt; General.</div>
            {navigateTo && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-accent" onClick={() => navigateTo('settings', 'general')}>Open Google Settings</button>
              </div>
            )}
          </div>
        )}
        {calAuth && !loading && !gcalEvents.length && (
          <div style={{ marginTop: 14, color: 'var(--muted)', fontSize: 13 }}>
            No upcoming Google Calendar events were returned for this account.
          </div>
        )}
      </div>
      {selectedEvent && (
        <div className="modal-overlay" style={{ alignItems: 'center', padding: 16 }} onClick={event => { if (event.target === event.currentTarget) setSelectedEvent(null); }}>
          <div className="modal" style={{ width: 'min(560px, calc(100vw - 32px))', maxWidth: 560, margin: 0 }} onClick={event => event.stopPropagation()}>
            <div className="title-row" style={{ marginBottom: 18 }}>
              <div>
                <div className="pill">Calendar Event</div>
                <h2 style={{ marginBottom: 6 }}>{selectedEvent.customerName || selectedEvent.summary}</h2>
                <div className="sub">{selectedEvent.serviceLabel || selectedEvent.summary}</div>
              </div>
              <button className="btn btn-sm" onClick={() => setSelectedEvent(null)}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>When</div>
                <div style={{ fontWeight: 700 }}>{selectedEvent.dateKey}</div>
                <div style={{ marginTop: 4 }}>{selectedEvent.timeLabel}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>CRM Link</div>
                <div style={{ fontWeight: 700 }}>{selectedEvent.linkedJob ? 'Linked to service job' : 'Google event only'}</div>
                <div style={{ marginTop: 4 }}>
                  {selectedEvent.linkedJob
                    ? `Job #${selectedEvent.jobNumber || selectedEvent.linkedJob.id}${selectedEvent.status ? ` â€¢ ${selectedEvent.status}` : ''}`
                    : 'No matching CRM job record found'}
                </div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>Customer</div>
                <div style={{ fontWeight: 700 }}>{selectedEvent.customerName || 'Not identified from CRM'}</div>
                <div style={{ marginTop: 4 }}>{selectedEvent.phone || 'No phone on linked customer'}</div>
                <div style={{ marginTop: 2, wordBreak: 'break-word' }}>{selectedEvent.email || 'No email on linked customer'}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>Location</div>
                <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{selectedEvent.location || 'No location provided'}</div>
              </div>
            </div>
            {selectedEvent.notes && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)', marginTop: 12 }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 6 }}>Notes</div>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{selectedEvent.notes}</div>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {selectedEventPhoneLink && <a className="btn btn-sm" href={`tel:${selectedEventPhoneLink}`}>Call</a>}
              {selectedEvent.email && <a className="btn btn-sm" href={`mailto:${selectedEvent.email}`}>Email</a>}
              {selectedEvent.location && <a className="btn btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedEvent.location)}`} target="_blank" rel="noopener noreferrer">Map</a>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <div className="card" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px' }}>
      <h2>Privacy Policy</h2>
      <p className="small">Last Updated: March 2026</p>
      <p>This Privacy Policy explains how FieldOps Demo CRM ("we," "us," or "our") collects, uses, and discloses your information when you use our website and services.</p>
      <h3 style={{ marginTop: '24px' }}>Information We Collect</h3>
      <p>We collect information that you provide directly to us, such as when you create an account, update your profile, or use the interactive features of our CRM tools. This may include names, addresses, phone numbers, and job routing data.</p>
      <h3 style={{ marginTop: '24px' }}>How We Use Information</h3>
      <p>The information we collect is used to provide, maintain, and improve our services. Specifically, we use it to facilitate payroll calculations, optimize dispatch routing, and provide customer support. We do not sell your personal data to third-party marketers.</p>
      <h3 style={{ marginTop: '24px' }}>Third-Party Services</h3>
      <p>Our service integrates with third-party APIs (such as Google Maps and Google Calendar) to provide routing and scheduling features. Your use of these integrations is also governed by the respective privacy policies of those third-party providers.</p>
      <h3 style={{ marginTop: '24px' }}>Contact Us</h3>
      <p>If you have any questions about this Privacy Policy, please contact us at privacy@example.invalid.</p>
    </div>
  );
}

function TermsOfService() {
  return (
    <div className="card" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px' }}>
      <h2>Terms of Service</h2>
      <p className="small">Last Updated: March 2026</p>
      <p>Welcome to FieldOps Demo CRM. By accessing or using our application, you agree to be bound by these Terms of Service.</p>
      <h3 style={{ marginTop: '24px' }}>Use of the Service</h3>
      <p>FieldOps Demo CRM provides business management, payroll calculation, and scheduling tools. You agree to use these services only for lawful business purposes. You are responsible for maintaining the confidentiality of your account credentials.</p>
      <h3 style={{ marginTop: '24px' }}>User Content</h3>
      <p>You retain all rights to the data you input into the system (e.g., customer details, job amounts). By using the service, you grant us a license to host and process this data solely for the purpose of providing the service to you.</p>
      <h3 style={{ marginTop: '24px' }}>Disclaimer of Warranties</h3>
      <p>The service is provided on an "AS IS" and "AS AVAILABLE" basis. We do not warrant that the service will be uninterrupted or error-free. Payroll calculations and route optimizations are provided as helpful tools, but final financial and logistical responsibility rests with your business management.</p>
      <h3 style={{ marginTop: '24px' }}>Limitation of Liability</h3>
      <p>In no event shall FieldOps Demo CRM or its operators be liable for any indirect, incidental, special, or consequential damages arising out of or in connection with your use of the service.</p>
    </div>
  );
}

// â”€â”€â”€ ESTIMATES TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ESTIMATE_PRICING_URL = '/pricing.json';
const ESTIMATE_PRICING_DEFAULTS = {
  minimumCharge: 75,
  serviceLevelMultipliers: { both: 1, ext: 0.6 },
  propertyTypes: {
    res: {
      windows: { doubleHung: 10, smallPane: 1.875, casement: 8, picture: 7.5, storm: 16, skylight: 45 },
      extras: { screens: 2, tracks: 3, upperFloorAccess: 12 }
    },
    com: {
      windows: { doubleHung: 12, smallPane: 2.375, casement: 10, picture: 9.5, storm: 20, skylight: 55 },
      extras: { screens: 1.5, tracks: 2, upperFloorAccess: 15 }
    }
  },
  addons: {
    pressure: { rate: 45 },
    gutter: { rate: 35, multiplier: 0.5 },
    caulk: { rate: 200, mode: "per-hour" }
  },
  adjustments: {
    hardWater: { multiplier: 1.25 },
    paintDebris: { flat: 35 },
    ladderWork: { flat: 25 },
    manualSkylightCleaning: { flat: 20 },
    lightFixture: { flat: 15 }
  },
  // Commercial frequency matrix â€” controls the rate table printed on commercial estimates.
  // extMultiplier: multiplier applied to In/Ext. price to get Ext. Only column.
  // storefrontMultiplier: multiplier applied to In/Ext. price to get Storefront I/E column.
  // rows: each entry drives one row in the printed matrix.
  commercialFrequencyMatrix: {
    extMultiplier: 0.6,
    storefrontMultiplier: 0.97,
    rows: [
      { label: 'Monthly', multiplier: 0.90 },
      { label: 'Quarterly', multiplier: 0.95 },
      { label: 'Triannually', multiplier: 0.97 },
      { label: 'Biannually', multiplier: 1.00 },
      { label: 'Annually', multiplier: 1.00 },
    ]
  }
};

const ESTIMATE_WINDOW_TYPES = {
  doubleHung: 'Double-Hung',
  smallPane: 'Small Pane',
  casement: 'Casement',
  slider: 'Slider',
  picture: 'Picture',
  patio: 'Patio Door',
  storm: 'Storm',
  skylight: 'Skylight'
};
const ESTIMATE_WINDOW_PRICING_ALIASES = Object.freeze({
  slider: 'casement',
  patio: 'picture',
});

const ESTIMATE_FREQUENCY_OPTIONS = [
  { value: '1.0', label: 'One-Time (No Discount)' },
  { value: '0.9', label: 'Monthly (10% Discount)' },
  { value: '0.95', label: 'Quarterly (5% Discount)' },
];

const ESTIMATE_CONDITION_OPTIONS = [
  { value: '1.0', label: 'Normal / Average (1x)' },
  { value: '1.15', label: 'Slightly Dirty (1.15x)' },
  { value: '1.3', label: 'Heavy Soil / Overgrown (1.3x)' },
  { value: '1.5', label: 'Post-Construction (1.5x)' },
];

const PROFIT_ANALYSIS_SETTINGS_KEY = 'crm_profit_analysis_defaults';
const PROFIT_ANALYSIS_TARGET_LABOR_PERCENT = 80;
const PROFIT_ANALYSIS_TARGET_OFFICE_PERCENT = 10;
const PROFIT_ANALYSIS_TARGET_EXPENSE_PERCENT = 10;
const PROFIT_ANALYSIS_DEFAULTS = Object.freeze({
  vehicleMpg: 18,
  gasPrice: 3.50,
  maintenanceCostPerMile: 0.20,
  suppliesCost: 5,
  equipmentDepreciation: 3,
  fixedCostAllocationOverride: 25,
});

function loadProfitAnalysisDefaults() {
  const defaults = { ...PROFIT_ANALYSIS_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(PROFIT_ANALYSIS_SETTINGS_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    Object.keys(defaults).forEach(key => {
      defaults[key] = estimatePricingNumber(saved[key], defaults[key]);
    });
  } catch { }
  return defaults;
}

function cloneEstimatePricingConfig(value = ESTIMATE_PRICING_DEFAULTS) {
  return JSON.parse(JSON.stringify(value));
}

function estimatePricingObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function estimatePricingNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function estimateSelectedWindowAverageRate(windowCounts = {}, windowPrices = {}, serviceMultiplier = 1) {
  let totalCount = 0;
  let totalRevenue = 0;
  Object.entries(windowCounts || {}).forEach(([type, count]) => {
    const normalizedCount = Math.max(0, Number(count) || 0);
    const pricingType = ESTIMATE_WINDOW_PRICING_ALIASES[type] || type;
    const baseRate = Number(windowPrices?.[pricingType]) || 0;
    if (!normalizedCount || !baseRate) return;
    const activeRate = baseRate * (Number(serviceMultiplier) || 1);
    totalCount += normalizedCount;
    totalRevenue += normalizedCount * activeRate;
  });
  return totalCount > 0 ? Math.round((totalRevenue / totalCount) * 100) / 100 : 0;
}

function normalizeEstimatePricingConfig(rawConfig) {
  const next = cloneEstimatePricingConfig();
  const root = estimatePricingObject(rawConfig);
  if (!root) return next;

  const multipliers = estimatePricingObject(root.serviceLevelMultipliers);
  if (multipliers) {
    next.serviceLevelMultipliers.both = estimatePricingNumber(multipliers.both, next.serviceLevelMultipliers.both);
    next.serviceLevelMultipliers.ext = estimatePricingNumber(multipliers.ext, next.serviceLevelMultipliers.ext);
  }

  const propertyTypes = estimatePricingObject(root.propertyTypes);
  ['res', 'com'].forEach(propertyKey => {
    const property = estimatePricingObject(propertyTypes?.[propertyKey]);
    const windows = estimatePricingObject(property?.windows);
    const extras = estimatePricingObject(property?.extras);
    if (windows) {
      next.propertyTypes[propertyKey].windows.doubleHung = estimatePricingNumber(windows.doubleHung, next.propertyTypes[propertyKey].windows.doubleHung);
      next.propertyTypes[propertyKey].windows.casement = estimatePricingNumber(windows.casement, next.propertyTypes[propertyKey].windows.casement);
      next.propertyTypes[propertyKey].windows.picture = estimatePricingNumber(windows.picture, next.propertyTypes[propertyKey].windows.picture);
      next.propertyTypes[propertyKey].windows.storm = estimatePricingNumber(windows.storm, next.propertyTypes[propertyKey].windows.storm);
      next.propertyTypes[propertyKey].windows.skylight = estimatePricingNumber(windows.skylight, next.propertyTypes[propertyKey].windows.skylight);
    }
    if (extras) {
      next.propertyTypes[propertyKey].extras.screens = estimatePricingNumber(extras.screens, next.propertyTypes[propertyKey].extras.screens);
      next.propertyTypes[propertyKey].extras.tracks = estimatePricingNumber(extras.tracks, next.propertyTypes[propertyKey].extras.tracks);
      next.propertyTypes[propertyKey].extras.upperFloorAccess = estimatePricingNumber(extras.upperFloorAccess, next.propertyTypes[propertyKey].extras.upperFloorAccess);
    }
  });

  const addons = estimatePricingObject(root.addons);
  const pressure = estimatePricingObject(addons?.pressure);
  const gutter = estimatePricingObject(addons?.gutter);
  const caulk = estimatePricingObject(addons?.caulk);
  if (pressure) next.addons.pressure.rate = estimatePricingNumber(pressure.rate, next.addons.pressure.rate);
  if (gutter) {
    next.addons.gutter.rate = estimatePricingNumber(gutter.rate, next.addons.gutter.rate);
    next.addons.gutter.multiplier = estimatePricingNumber(gutter.multiplier, next.addons.gutter.multiplier);
  }
  if (caulk) {
    next.addons.caulk.rate = estimatePricingNumber(caulk.rate, next.addons.caulk.rate);
    if (typeof caulk.mode === 'string' && caulk.mode.trim()) next.addons.caulk.mode = caulk.mode.trim();
  }

  const adjustments = estimatePricingObject(root.adjustments);
  const hardWater = estimatePricingObject(adjustments?.hardWater);
  const paintDebris = estimatePricingObject(adjustments?.paintDebris);
  const ladderWork = estimatePricingObject(adjustments?.ladderWork);
  const manualSkylightCleaning = estimatePricingObject(adjustments?.manualSkylightCleaning);
  const lightFixture = estimatePricingObject(adjustments?.lightFixture);
  if (hardWater) {
    const hardWaterMultiplier = estimatePricingNumber(hardWater.multiplier, NaN);
    const legacyHardWaterMultiplier = estimatePricingNumber(hardWater.flat, NaN);
    if (Number.isFinite(hardWaterMultiplier)) {
      next.adjustments.hardWater.multiplier = hardWaterMultiplier;
    } else if (Number.isFinite(legacyHardWaterMultiplier) && legacyHardWaterMultiplier > 0 && legacyHardWaterMultiplier <= 5) {
      next.adjustments.hardWater.multiplier = legacyHardWaterMultiplier;
    }
  }
  if (paintDebris) next.adjustments.paintDebris.flat = estimatePricingNumber(paintDebris.flat, next.adjustments.paintDebris.flat);
  if (ladderWork) next.adjustments.ladderWork.flat = estimatePricingNumber(ladderWork.flat, next.adjustments.ladderWork.flat);
  if (manualSkylightCleaning) next.adjustments.manualSkylightCleaning.flat = estimatePricingNumber(manualSkylightCleaning.flat, next.adjustments.manualSkylightCleaning.flat);
  if (lightFixture) next.adjustments.lightFixture.flat = estimatePricingNumber(lightFixture.flat, next.adjustments.lightFixture.flat);

  next.minimumCharge = estimatePricingNumber(root.minimumCharge, next.minimumCharge);

  const commercialMatrix = estimatePricingObject(root.commercialFrequencyMatrix);
  if (commercialMatrix) {
    next.commercialFrequencyMatrix.extMultiplier = estimatePricingNumber(commercialMatrix.extMultiplier, next.commercialFrequencyMatrix.extMultiplier);
    next.commercialFrequencyMatrix.storefrontMultiplier = estimatePricingNumber(commercialMatrix.storefrontMultiplier, next.commercialFrequencyMatrix.storefrontMultiplier);
    if (Array.isArray(commercialMatrix.rows) && commercialMatrix.rows.length > 0) {
      next.commercialFrequencyMatrix.rows = commercialMatrix.rows.map((row, i) => ({
        label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : (next.commercialFrequencyMatrix.rows[i]?.label ?? `Row ${i + 1}`),
        multiplier: estimatePricingNumber(row.multiplier, next.commercialFrequencyMatrix.rows[i]?.multiplier ?? 1.0),
      }));
    }
  }

  return next;
}

function clampEstimateCount(value) {
  return Math.max(0, parseInt(value, 10) || 0);
}

function addEstimateWindowCount(setWindows, key, delta) {
  setWindows(prev => ({
    ...prev,
    [key]: Math.max(0, (Number(prev[key]) || 0) + delta)
  }));
}

function buildDefaultEstimateAddonDetails(estimateType = 'new') {
  return {
    pressureMode: 'power',
    pressureAreaUnits: 0,
    pressureSurfaceNotes: '',
    gutterSections: 0,
    caulkMode: 'window',
    caulkRawCount: 0,
    newCustomerDiscountEnabled: estimateType === 'new',
    seniorDiscountEnabled: false,
    seniorDiscountPercent: 0.05,
    frequencyDiscountEnabled: false,
    frequencyDiscountKey: '',
  };
}

function updateEstimateAddonDetails(setAddonDetails, patch) {
  setAddonDetails(prev => ({
    ...prev,
    ...(typeof patch === 'function' ? patch(prev) : patch)
  }));
}

function simplifyQuickEstimateLineItemLabel(label, serviceLevel) {
  const safeLabel = String(label || '').trim();
  if (!safeLabel) return 'Quoted Service';
  if (/(Double-Hung|Casement|Slider|Picture|Patio Door|Storm|Skylight)\s+Windows/i.test(safeLabel)) {
    return serviceLevel === 'ext' ? 'Exterior Window Cleaning' : 'Interior / Exterior Window Cleaning';
  }
  if (/^Screens\b/i.test(safeLabel)) return 'Screen Cleaning';
  if (/^Tracks\b/i.test(safeLabel)) return 'Track Cleaning';
  if (/^Upper-floor access/i.test(safeLabel)) return 'Upper Floor Access';
  if (/^Pressure Washing/i.test(safeLabel)) return 'Power Washing';
  if (/^Soft Washing/i.test(safeLabel)) return 'Soft Washing';
  if (/^Gutter Cleaning/i.test(safeLabel)) return 'Gutter Cleaning';
  if (/^Caulking \/ Sealing/i.test(safeLabel)) return 'Caulking / Sealing';
  if (/^Condition Adj\./i.test(safeLabel)) return 'Condition Adjustment';
  if (/^Hard Water Removal/i.test(safeLabel)) return 'Hard Water Removal';
  if (/^Construction\/Paint Removal/i.test(safeLabel)) return 'Paint or Construction Debris';
  if (/^Ladder Access/i.test(safeLabel)) return 'Ladder Access';
  if (/^Skylights Manual/i.test(safeLabel)) return 'Manual Skylight Cleaning';
  if (/^Light Fixtures\/Fans/i.test(safeLabel)) return 'Light Fixtures / Fans';
  if (/^10% OFF New Customer/i.test(safeLabel)) return 'New Customer Discount';
  if (/^Senior Discount/i.test(safeLabel)) return 'Senior Discount';
  if (/^Frequency Adj\./i.test(safeLabel)) return 'Frequency Pricing';
  if (/^Minimum charge adjustment/i.test(safeLabel)) return 'Minimum Charge Adjustment';
  return safeLabel.replace(/\s*\(.+\)\s*$/, '');
}

function getEstimateGenerationErrors({
  estimateType,
  selectedCustomerId,
  form,
  estimateData,
  useManualProposalLines,
  manualTotalActive,
  manualTotalOverride,
  manualTotalReason
}) {
  const errors = [];

  if (!useManualProposalLines && !estimateData.hasScope && !manualTotalActive) {
    errors.push('Enter at least one service or pane count before generating an estimate.');
  }

  if (estimateType === 'new') {
    if (!String(form.name || '').trim()) errors.push('Customer name is required.');
    if (!String(form.address || '').trim()) errors.push('Service address is required.');
  }

  if (estimateType !== 'new' && !selectedCustomerId) {
    errors.push('Select an existing customer before generating the estimate.');
  }

  if (!useManualProposalLines && manualTotalActive && !(Number(manualTotalOverride) >= 0)) {
    errors.push('Final price override must be a valid non-negative amount.');
  }

  if (!useManualProposalLines && manualTotalActive && manualTotalReason !== undefined && !String(manualTotalReason || '').trim()) {
    errors.push('Enter a reason for the final price override.');
  }

  return errors;
}

function EstimatesTab({
  customers,
  setCustomers,
  serviceJobs,
  setServiceJobs,
  apiFetch: estimateApiFetch,
  onProfitSnapshotChange = () => { },
  travelRoutingSettings = DEFAULT_TRAVEL_ROUTING_SETTINGS,
  travelRoutingLoading = false,
  travelRoutingError = '',
}) {
  const [estimateType, setEstimateType] = useState('new');
  const [propertyType, setPropertyType] = useState('res');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [form, setForm] = useState({
    name: '',
    address: '',
    cityStateZip: '',
    phone: '',
    email: '',
    frequency: '1.0',
    condition: '1.0',
    notes: '',
    otherText: ''
  });
  const [serviceLevel, setServiceLevel] = useState('both');
  const [floors, setFloors] = useState(2);
  const [windows, setWindows] = useState({ doubleHung: 0, smallPane: 0, casement: 0, slider: 0, picture: 0, patio: 0, storm: 0, skylight: 0 });
  const [extras, setExtras] = useState({
    screens: 0,
    tracks: 0,
    hardWater: 0,
    paintDebris: 0,
    ladderWork: 0,
    skylights: 0,
    lightFixture: 0
  });
  const [addons, setAddons] = useState({ pressure: 0, gutter: 0, caulk: 0 });
  const [addonDetails, setAddonDetails] = useState(() => buildDefaultEstimateAddonDetails(estimateType));
  const [pricingConfig, setPricingConfig] = useState(() => cloneEstimatePricingConfig());
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [pricingLoadError, setPricingLoadError] = useState('');
  const [manualTotalOverride, setManualTotalOverride] = useState('');
  const [manualTotalReason, setManualTotalReason] = useState('');
  const [useManualProposalLines, setUseManualProposalLines] = useState(false);
  const [manualProposalLines, setManualProposalLines] = useState([]);
  const [copyStatus, setCopyStatus] = useState('');
  const [showPriceAnalysisModal, setShowPriceAnalysisModal] = useState(false);
  const [builderTravelRoute, setBuilderTravelRoute] = useState(() => ({
    status: 'idle',
    routeAddress: '',
    oneWayMiles: 0,
    roundTripMiles: 0,
    durationMin: 0,
    error: '',
    label: buildTravelRouteLabel(
      travelRoutingSettings?.homeBaseAddress,
      travelRoutingSettings?.workerPickupAddress
    ),
  }));
  const [newCustomerDiscountTouched, setNewCustomerDiscountTouched] = useState(false);
  const [phoneScriptServiceKey, setPhoneScriptServiceKey] = useState('windowCleaning');
  const estimateMessageRef = useRef(null);
  const travelRouteRequestRef = useRef(0);
  const phoneScriptOpening = [
    'Thank you for calling FieldOps Demo, how can I help you?',
    'Can I ask a few quick questions and get a rough estimate started for you?',
    'Are you thinking exterior only, interior and exterior, or did you have another service in mind besides window cleaning?'
  ];
  const phoneScriptServiceOptions = [
    { key: 'windowCleaning', label: 'Window Cleaning' },
    { key: 'pressureWashing', label: 'Pressure Washing / Soft Washing' },
    { key: 'gutterCleaning', label: 'Gutter Cleaning' },
    { key: 'hardWaterRemoval', label: 'Hard Water Removal' },
    { key: 'constructionCleanup', label: 'Construction / Paint Cleanup' }
  ];
  const phoneScriptServiceFollowUps = {
    windowCleaning: [
      'Roughly how many pieces of glass are we cleaning?',
      'No worries if the count is not exact. A close guess is enough for a rough estimate, and we can follow up with a more accurate estimate before scheduling if you would like.',
      'Do you want the screens cleaned too?',
      'Do you want the tracks cleaned, or just the glass and a basic wipe-down?',
      'Do you have any storm windows?',
      'Is most of the glass on the first floor, second floor, or higher?',
      'Any hard water staining, paint, construction debris, or difficult access we should know about?'
    ],
    pressureWashing: [
      'What surface are we cleaning â€” siding, a building wall, a deck, concrete, pavement, or something else?',
      'About how large is the area?',
      'Is there heavy algae, mildew, dirt buildup, oil staining, or anything delicate we should know about?',
      'Is there easy water access nearby?'
    ],
    gutterCleaning: [
      'Are the gutters on the whole house, just one section, or a detached garage too?',
      'Is the home one story, two stories, or higher?',
      'Do the gutters have guards or covers on them?',
      'Are they just filled with leaves, or is there any heavy buildup or blockage?'
    ],
    hardWaterRemoval: [
      'Is the staining light, moderate, or heavy?',
      'Is it on regular windows, shower glass, storefront glass, or another surface?',
      'Do you know about how long the staining has been there?'
    ],
    constructionCleanup: [
      'Is it paint, stickers, tape, mortar, silicone, or general construction dust?',
      'Is the debris on the glass only, or also on the frames and tracks?',
      'Was the glass recently installed or is it older glass?'
    ]
  };
  const phoneScriptClosing = [
    'Okay, thank you. That gives us the basic scope.',
    'What name should I put the estimate under?',
    'What is the service address?',
    'What is the best phone number for the estimate?',
    'Do you want an email on the estimate too, or is phone/text better?',
    'What dates do you have in mind? If you can give us two preferred dates, we will do our best to get you scheduled for one of them.',
    'Okay, great. Based on all of that, I can give you the quick estimate now.',
    'Sorry, one second. I am just putting everything through the computer.',
    'If anything changes after we review the details, we will explain it before doing the work.'
  ];

  const activePhoneScriptFollowUps =
    phoneScriptServiceFollowUps[phoneScriptServiceKey] || phoneScriptServiceFollowUps.windowCleaning;

  const phoneScriptQuestions = [
    ...phoneScriptOpening,
    ...activePhoneScriptFollowUps,
    ...phoneScriptClosing
  ];

  const quickPaneButtons = [
    { title: 'Double-Hung Window', helper: 'Traditional split window with separate upper and lower glass sections.', addLabel: 'Add Double-Hung Window', key: 'doubleHung', delta: 1 },
    { title: 'Small Pane / French Pane', helper: 'Individual small pane or cut-up. Priced at 25% of a picture window pane.', addLabel: 'Add Small Pane', key: 'smallPane', delta: 1 },
    { title: 'Casement Window', helper: 'Swing-out window with a simple pane layout.', addLabel: 'Add Casement Window', key: 'casement', delta: 1 },
    { title: 'Slider Window', helper: 'Sliding window with side-by-side glass sections.', addLabel: 'Add Slider Window', key: 'slider', delta: 2 },
    { title: 'Picture Window', helper: 'Broad fixed glass section without a moving sash.', addLabel: 'Add Picture Window', key: 'picture', delta: 1 },
    { title: 'Patio Door', helper: 'Large glass door opening or wide fixed glass panel.', addLabel: 'Add Patio Door', key: 'patio', delta: 2 },
    { title: 'Storm Window', helper: 'Extra removable glass layer that needs separate attention.', addLabel: 'Add Storm Window', key: 'storm', delta: 1 },
    { title: 'Skylight', helper: 'Overhead glass opening that needs separate cleaning.', addLabel: 'Add Skylight', key: 'skylight', delta: 1 },
  ];
  const quickPlainExtraOptions = [
    { key: 'screens', label: 'Screens Needed', helper: 'Include screen cleaning when needed.' },
    { key: 'tracks', label: 'Tracks Needed', helper: 'Include track cleaning when needed.' },
    { key: 'hardWater', label: 'Hard Water Present', helper: 'Use this when the glass shows mineral buildup or staining.' },
    { key: 'paintDebris', label: 'Paint or Construction Debris Present', helper: 'Use this for post-construction residue or paint on the glass.' },
    { key: 'ladderWork', label: 'Ladder Access Needed', helper: 'Use this when setup or access is more difficult than a standard reach.' },
    { key: 'lightFixture', label: 'Light Fixtures / Fans Needed', helper: 'Include this when nearby fixtures or fans should be cleaned too.' },
  ];
  const estimateFrequencyDiscountOptions = [
    { key: 'oneTime', label: 'One-time / No frequency discount', value: '1.0' },
    { key: 'monthly', label: 'Monthly', value: '0.9' },
    { key: 'quarterly', label: 'Quarterly', value: '0.95' },
    { key: 'semiAnnual', label: 'Semi-Annual', value: '1.0' },
    { key: 'annual', label: 'Annual', value: '1.0' },
    { key: 'returningSameLocation', label: 'Returning Same Location', value: '1.0' },
  ];
  const ESTIMATE_SELECTABLE_FREQUENCY_KEYS = ['oneTime', 'monthly', 'quarterly'];
  const ESTIMATE_ACTIVE_FREQUENCY_DISCOUNT_KEYS = ['monthly', 'quarterly'];
  const quickFrequencyLabels = { oneTime: 'One-Time Service', monthly: 'Monthly Service', quarterly: 'Quarterly Service' };
  const detailedFrequencyLabels = { oneTime: 'One-Time / No Discount', monthly: 'Monthly (10% off)', quarterly: 'Quarterly (5% off)' };
  const visibleFrequencyDiscountKey = ESTIMATE_SELECTABLE_FREQUENCY_KEYS.includes(addonDetails.frequencyDiscountKey) ? addonDetails.frequencyDiscountKey : 'oneTime';
  const isFrequencyDiscountActive = addonDetails.frequencyDiscountEnabled && ESTIMATE_ACTIVE_FREQUENCY_DISCOUNT_KEYS.includes(addonDetails.frequencyDiscountKey);

  useEffect(() => {
    let cancelled = false;

    try {
      const saved = localStorage.getItem('crm_pricing_config');
      if (saved) {
        setPricingConfig(normalizeEstimatePricingConfig(JSON.parse(saved)));
        return;
      }
    } catch { }

    (async () => {
      try {
        const response = await fetch(ESTIMATE_PRICING_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rawConfig = await response.json();
        if (cancelled) return;
        setPricingConfig(normalizeEstimatePricingConfig(rawConfig));
        setPricingLoadError('');
      } catch (loadError) {
        if (cancelled) return;
        setPricingConfig(cloneEstimatePricingConfig());
        setPricingLoadError('Estimate pricing could not be loaded. Using built-in estimate pricing fallback.');
        console.warn('Failed to load CRM pricing.json for estimates.', loadError);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const roundCurrency = value => Math.round((Number(value) || 0) * 100) / 100;
  const pressureAreaUnits = clampEstimateCount(addonDetails.pressureAreaUnits);
  const gutterSections = clampEstimateCount(addonDetails.gutterSections);
  const caulkRawCount = clampEstimateCount(addonDetails.caulkRawCount);
  const caulkBillableUnits = addonDetails.caulkMode === 'surfaceJoint'
    ? caulkRawCount * 3
    : caulkRawCount;
  const selectedFrequencyDiscountOption = estimateFrequencyDiscountOptions.find(option => option.key === addonDetails.frequencyDiscountKey)
    || estimateFrequencyDiscountOptions[0];
  const pressureServiceLabel = addonDetails.pressureMode === 'soft' ? 'Soft Washing' : 'Power Washing';
  const caulkScopeLabel = addonDetails.caulkMode === 'surfaceJoint'
    ? `${caulkRawCount} surface joint${caulkRawCount === 1 ? '' : 's'} x 3`
    : `${caulkRawCount} window${caulkRawCount === 1 ? '' : 's'}`;
  const hardWaterUnitRate = useMemo(() => {
    const propertyPrices = pricingConfig.propertyTypes[propertyType];
    const serviceMultiplier = pricingConfig.serviceLevelMultipliers[serviceLevel] || 1;
    const averageWindowRate = estimateSelectedWindowAverageRate(windows, propertyPrices?.windows, serviceMultiplier);
    return roundCurrency(averageWindowRate * (Number(pricingConfig.adjustments?.hardWater?.multiplier) || 0));
  }, [pricingConfig, propertyType, serviceLevel, windows]);
  const pressureAreaLabel = `${pressureAreaUnits} x 36 sq ft area${pressureAreaUnits === 1 ? '' : 's'}`;
  const ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS = {
    monthly: 45,
    quarterly: 120,
    semiAnnual: 210,
    annual: 420
  };

  const estimateCustomerLookup = useMemo(() => {
    const lookup = new Map();
    (customers || []).forEach(customer => lookup.set(String(customer.id), customer));
    return lookup;
  }, [customers]);
  const normalizedTravelRouting = useMemo(
    () => normalizeTravelRoutingSettings(travelRoutingSettings),
    [travelRoutingSettings]
  );
  const routeSourceCustomer = estimateCustomerLookup.get(String(selectedCustomerId)) || null;
  const effectiveRouteStreet = normalizeEstimateText(routeSourceCustomer?.address || form.address || '');
  const effectiveRouteCityStateZip = normalizeEstimateText(routeSourceCustomer?.cityStateZip || form.cityStateZip || '');
  const effectiveRouteAddress = useMemo(
    () => buildRouteAddress(effectiveRouteStreet, effectiveRouteCityStateZip),
    [effectiveRouteCityStateZip, effectiveRouteStreet]
  );
  const travelRouteLabel = useMemo(
    () => buildTravelRouteLabel(normalizedTravelRouting.homeBaseAddress, normalizedTravelRouting.workerPickupAddress),
    [normalizedTravelRouting.homeBaseAddress, normalizedTravelRouting.workerPickupAddress]
  );
  const [debouncedRouteAddress, setDebouncedRouteAddress] = useState('');

  useEffect(() => {
    const nextAddress = String(effectiveRouteAddress || '').trim();
    if (!nextAddress) {
      setDebouncedRouteAddress('');
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setDebouncedRouteAddress(nextAddress), 500);
    return () => window.clearTimeout(timeoutId);
  }, [effectiveRouteAddress]);

  useEffect(() => {
    const routeAddress = String(debouncedRouteAddress || '').trim();
    const homeBaseAddress = String(normalizedTravelRouting.homeBaseAddress || '').trim();
    const workerPickupAddress = String(normalizedTravelRouting.workerPickupAddress || '').trim();
    const requestId = travelRouteRequestRef.current + 1;
    travelRouteRequestRef.current = requestId;
    const emptyState = {
      routeAddress,
      oneWayMiles: 0,
      roundTripMiles: 0,
      durationMin: 0,
      label: travelRouteLabel,
    };

    if (!routeAddress) {
      setBuilderTravelRoute({ status: 'idle', error: '', ...emptyState });
      return undefined;
    }
    if (travelRoutingLoading) {
      setBuilderTravelRoute({ status: 'waiting', error: '', ...emptyState });
      return undefined;
    }
    if (travelRoutingError) {
      setBuilderTravelRoute({
        status: 'error',
        error: 'Travel routing defaults could not be loaded. Enter mileage manually in Price Analysis.',
        ...emptyState,
      });
      return undefined;
    }
    if (!homeBaseAddress || !workerPickupAddress) {
      setBuilderTravelRoute({
        status: 'error',
        error: 'Travel routing defaults are missing. Enter mileage manually in Price Analysis.',
        ...emptyState,
      });
      return undefined;
    }

    let cancelled = false;
    setBuilderTravelRoute({ status: 'loading', error: '', ...emptyState });

    (async () => {
      try {
        const stops = [homeBaseAddress, workerPickupAddress, routeAddress];
        const geocodedStops = await Promise.all(stops.map(async address => {
          const data = await estimateApiFetch(`/api/geocode?address=${encodeURIComponent(address)}`);
          return { address, data };
        }));
        if (cancelled || requestId !== travelRouteRequestRef.current) return;

        const missingStop = geocodedStops.find(stop => !(stop.data?.lat && stop.data?.lng));
        if (missingStop) {
          throw new Error(
            missingStop.address === routeAddress
              ? 'Customer address could not be routed by road.'
              : 'Saved travel routing defaults could not be geocoded.'
          );
        }

        const coordStr = geocodedStops
          .map(stop => `${Number(stop.data.lng)},${Number(stop.data.lat)}`)
          .join(';');
        const routeData = await estimateApiFetch(
          `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false&steps=false`
        );
        if (cancelled || requestId !== travelRouteRequestRef.current) return;

        const route = routeData?.routes?.[0];
        if (!route?.distance) throw new Error('Driving route unavailable for this estimate.');

        const oneWayMiles = roundToTenths((Number(route.distance) || 0) * 0.000621371);
        const roundTripMiles = roundToTenths(oneWayMiles * 2);
        const durationMin = Math.max(0, Math.round((Number(route.duration) || 0) / 60));

        setBuilderTravelRoute({
          status: 'ready',
          routeAddress,
          oneWayMiles,
          roundTripMiles,
          durationMin,
          error: '',
          label: travelRouteLabel,
        });
      } catch (err) {
        if (cancelled || requestId !== travelRouteRequestRef.current) return;
        const isNetworkError = err instanceof TypeError && err.message === 'Failed to fetch';
        setBuilderTravelRoute({
          status: 'error',
          routeAddress,
          oneWayMiles: 0,
          roundTripMiles: 0,
          durationMin: 0,
          error: isNetworkError
            ? 'Travel miles unavailable. Enter mileage manually in Price Analysis.'
            : (err?.message || 'Travel miles unavailable. Enter mileage manually in Price Analysis.'),
          label: travelRouteLabel,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    debouncedRouteAddress,
    estimateApiFetch,
    normalizedTravelRouting.homeBaseAddress,
    normalizedTravelRouting.workerPickupAddress,
    travelRouteLabel,
    travelRoutingError,
    travelRoutingLoading,
  ]);

  useEffect(() => {
    if (!newCustomerDiscountTouched) {
      setAddonDetails(prev => {
        const nextDiscountEnabled = estimateType === 'new';
        return prev.newCustomerDiscountEnabled === nextDiscountEnabled
          ? prev
          : { ...prev, newCustomerDiscountEnabled: nextDiscountEnabled };
      });
    }
  }, [estimateType, newCustomerDiscountTouched]);

  useEffect(() => {
    setAddons(prev => {
      const nextPressure = pressureAreaUnits;
      const nextGutter = gutterSections;
      const nextCaulk = caulkBillableUnits;
      if (prev.pressure === nextPressure && prev.gutter === nextGutter && prev.caulk === nextCaulk) {
        return prev;
      }
      return {
        ...prev,
        pressure: nextPressure,
        gutter: nextGutter,
        caulk: nextCaulk,
      };
    });
  }, [caulkBillableUnits, gutterSections, pressureAreaUnits]);

  useEffect(() => {
    const nextFrequencyValue = isFrequencyDiscountActive
      ? selectedFrequencyDiscountOption.value
      : '1.0';
    setForm(prev => (
      prev.frequency === nextFrequencyValue
        ? prev
        : { ...prev, frequency: nextFrequencyValue }
    ));
  }, [isFrequencyDiscountActive, selectedFrequencyDiscountOption.value]);

  const repeatPricingAddress = normalizeEstimateText(
    form.address || estimateCustomerLookup.get(String(selectedCustomerId))?.address || ''
  );
  const repeatLocationPricingHint = useMemo(() => {
    const normalizedAddress = addressKey(repeatPricingAddress);
    if (!normalizedAddress) {
      return {
        message: '',
        recommendedKey: '',
        lastServiceDateLabel: '',
      };
    }

    const matchingJobs = (serviceJobs || [])
      .filter(job => String(job?.status || '').trim().toLowerCase() !== 'cancelled')
      .map(job => {
        const relatedCustomer = estimateCustomerLookup.get(String(job?.customerId || ''));
        const jobAddress = addressKey(job?.address || relatedCustomer?.address || '');
        if (jobAddress !== normalizedAddress) return null;
        const jobDateValue = job?.completedAt || job?.scheduledDate || job?.createdAt;
        const jobDate = jobDateValue ? new Date(jobDateValue) : null;
        return {
          job,
          isCompleted: String(job?.status || '').trim().toLowerCase() === 'completed',
          date: jobDate instanceof Date && !Number.isNaN(jobDate.getTime()) ? jobDate : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? -1 : 1;
        return (b.date?.getTime() || 0) - (a.date?.getTime() || 0);
      });

    const mostRelevantJob = matchingJobs[0];
    if (!mostRelevantJob?.date) {
      return {
        message: 'No recent service found for this address. Use standard one-time pricing unless approved.',
        recommendedKey: '',
        lastServiceDateLabel: '',
      };
    }

    const daysSinceService = Math.floor((Date.now() - mostRelevantJob.date.getTime()) / (1000 * 60 * 60 * 24));
    let recommendedKey = '';
    if (daysSinceService <= ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.monthly) recommendedKey = 'monthly';
    else if (daysSinceService <= ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.quarterly) recommendedKey = 'quarterly';
    else if (daysSinceService <= ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.semiAnnual) recommendedKey = 'semiAnnual';
    else if (daysSinceService <= ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.annual) recommendedKey = 'annual';

    return {
      message: recommendedKey
        ? 'This address appears to have been serviced recently. Frequency pricing may apply.'
        : 'No recent service found for this address. Use standard one-time pricing unless approved.',
      recommendedKey,
      lastServiceDateLabel: mostRelevantJob.date.toLocaleDateString('en-US'),
    };
  }, [ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.annual, ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.monthly, ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.quarterly, ESTIMATE_REPEAT_SERVICE_WINDOWS_DAYS.semiAnnual, estimateCustomerLookup, repeatPricingAddress, serviceJobs, selectedCustomerId]);

  const manualProposalServiceTitles = useMemo(() => normalizeManualProposalLines(manualProposalLines)
    .filter(line => line.hasTitle)
    .map(line => line.title), [manualProposalLines]);

  const estimateServiceSelection = useMemo(() => {
    const totalWindows = Object.values(windows).reduce((sum, count) => sum + (Number(count) || 0), 0);
    const mappedOtherLines = [
      form.otherText.trim(),
      addons.caulk > 0 ? 'Caulking / Sealing' : '',
      extras.tracks > 0 ? 'Track Cleaning' : '',
      extras.skylights > 0 ? 'Manual Skylight Cleaning' : '',
      extras.ladderWork > 0 ? 'Ladder Access' : '',
      extras.lightFixture > 0 ? 'Light Fixture/Ceiling Fan or Vent Cleaning' : '',
    ].filter(Boolean);
    const calculatorOtherServiceText = mappedOtherLines.join(', ');
    const manualProposalOtherServiceText = manualProposalServiceTitles.join(', ');
    const shouldUseManualProposalServiceSelection = useManualProposalLines && manualProposalServiceTitles.length > 0;
    const otherServiceText = shouldUseManualProposalServiceSelection
      ? manualProposalOtherServiceText
      : calculatorOtherServiceText;
    const serviceFlags = {
      interiorExterior: !shouldUseManualProposalServiceSelection && totalWindows > 0 && serviceLevel === 'both',
      exterior: !shouldUseManualProposalServiceSelection && totalWindows > 0 && serviceLevel === 'ext',
      interior: false,
      pressureWashing: !shouldUseManualProposalServiceSelection && addons.pressure > 0,
      screenCleaning: !shouldUseManualProposalServiceSelection && extras.screens > 0,
      hardWater: !shouldUseManualProposalServiceSelection && extras.hardWater > 0,
      construction: !shouldUseManualProposalServiceSelection && extras.paintDebris > 0,
      gutter: !shouldUseManualProposalServiceSelection && addons.gutter > 0,
      other: Boolean(otherServiceText),
    };
    const serviceLabels = [];
    if (serviceFlags.interiorExterior) serviceLabels.push('Inside/Outside Window Cleaning');
    if (serviceFlags.exterior) serviceLabels.push('Exterior Window Cleaning');
    if (serviceFlags.pressureWashing) serviceLabels.push(pressureServiceLabel);
    if (serviceFlags.screenCleaning) serviceLabels.push('Screen Cleaning');
    if (serviceFlags.hardWater) serviceLabels.push('Hard Water Removal');
    if (serviceFlags.construction) serviceLabels.push('Construction/Paint Removal');
    if (serviceFlags.gutter) serviceLabels.push('Gutter Cleaning');
    if (serviceFlags.other) serviceLabels.push(otherServiceText);
    return {
      serviceFlags,
      selectedServices: getSelectedReceiptServices(serviceFlags),
      otherServiceText,
      serviceTypeLabel: serviceLabels.join(', ') || 'Estimate Scope Pending',
    };
  }, [addons.caulk, addons.gutter, addons.pressure, extras.hardWater, extras.ladderWork, extras.lightFixture, extras.paintDebris, extras.screens, extras.skylights, extras.tracks, form.otherText, manualProposalServiceTitles, pressureServiceLabel, serviceLevel, useManualProposalLines, windows]);

  const estimateData = useMemo(() => {
    const propertyKey = propertyType;
    const prices = pricingConfig.propertyTypes[propertyKey];
    const serviceMultiplier = pricingConfig.serviceLevelMultipliers[serviceLevel] || 1;
    const normalizedFloors = Math.max(1, Number(floors) || 1);
    const lineItems = [];
    let runningTotal = 0;
    let totalWindows = 0;
    let totalWindowRevenue = 0;

    const addLine = (label, amount, { quoteOnly = false, accent = false } = {}) => {
      const roundedAmount = roundCurrency(amount);
      lineItems.push({ label, amount: roundedAmount, quoteOnly, accent });
      if (!quoteOnly) runningTotal = roundCurrency(runningTotal + roundedAmount);
    };

    Object.entries(windows).forEach(([type, count]) => {
      if (count > 0) {
        totalWindows += count;
        const pricingType = ESTIMATE_WINDOW_PRICING_ALIASES[type] || type;
        const rate = (Number(prices.windows[pricingType]) || 0) * serviceMultiplier;
        totalWindowRevenue += count * rate;
        addLine(`${ESTIMATE_WINDOW_TYPES[type]} Windows (${count})`, count * rate);
      }
    });

    if (extras.screens > 0) addLine(`Screens (${extras.screens})`, extras.screens * prices.extras.screens);
    if (extras.tracks > 0) addLine(`Tracks (${extras.tracks})`, extras.tracks * prices.extras.tracks);

    const extraFloors = Math.max(0, normalizedFloors - 1);
    if (extraFloors > 0 && (totalWindows > 0 || extras.screens > 0 || extras.tracks > 0)) {
      addLine(`Upper-floor access (${extraFloors} floor(s))`, extraFloors * prices.extras.upperFloorAccess);
    }

    if (addons.pressure > 0) {
      const pressureMultiplier = addonDetails.pressureMode === 'soft' ? 1.4 : 1;
      addLine(
        `${pressureServiceLabel} (${addons.pressure} x 36 sq ft area${addons.pressure === 1 ? '' : 's'})`,
        addons.pressure * pricingConfig.addons.pressure.rate * normalizedFloors * pressureMultiplier
      );
    }

    if (addons.gutter > 0) {
      addLine(
        `Gutter Cleaning (${addons.gutter} section${addons.gutter === 1 ? '' : 's'})`,
        addons.gutter * pricingConfig.addons.gutter.rate * normalizedFloors * pricingConfig.addons.gutter.multiplier
      );
    }

    if (addons.caulk > 0) {
      const caulkLineLabel = `Caulking / Sealing (${caulkScopeLabel})`;
      if (pricingConfig.addons.caulk.mode === 'interest-only') {
        addLine(caulkLineLabel, 0, { quoteOnly: true });
      } else {
        addLine(caulkLineLabel, addons.caulk * pricingConfig.addons.caulk.rate);
      }
    }

    const baseScopeTotal = runningTotal;
    const averageSelectedWindowRate = totalWindows > 0 ? (totalWindowRevenue / totalWindows) : 0;
    const conditionMultiplier = Number(form.condition) || 1;
    if (baseScopeTotal > 0 && conditionMultiplier !== 1) addLine('Condition Adj.', baseScopeTotal * (conditionMultiplier - 1));
    if (extras.hardWater > 0 && averageSelectedWindowRate > 0) {
      addLine(
        `Hard Water Removal (Ã—${extras.hardWater})`,
        extras.hardWater * averageSelectedWindowRate * pricingConfig.adjustments.hardWater.multiplier
      );
    }
    if (extras.paintDebris > 0) addLine(`Construction/Paint Removal (Ã—${extras.paintDebris})`, extras.paintDebris * pricingConfig.adjustments.paintDebris.flat);
    if (extras.ladderWork > 0) addLine(`Ladder Access (Ã—${extras.ladderWork})`, extras.ladderWork * pricingConfig.adjustments.ladderWork.flat);
    if (extras.skylights > 0) addLine(`Skylights Manual (Ã—${extras.skylights})`, extras.skylights * pricingConfig.adjustments.manualSkylightCleaning.flat);
    if (extras.lightFixture > 0) addLine(`Light Fixtures/Fans (Ã—${extras.lightFixture})`, extras.lightFixture * pricingConfig.adjustments.lightFixture.flat);

    const preDiscountTotal = runningTotal;
    if (addonDetails.newCustomerDiscountEnabled && runningTotal > 0) {
      addLine('10% OFF New Customer', -(runningTotal * 0.10), { accent: true });
    }
    if (addonDetails.seniorDiscountEnabled && runningTotal > 0) {
      addLine(`Senior Discount (${Math.round((Number(addonDetails.seniorDiscountPercent) || 0) * 100)}% OFF)`, -(runningTotal * (Number(addonDetails.seniorDiscountPercent) || 0)), { accent: true });
    }
    if (addonDetails.frequencyDiscountEnabled) {
      const frequencyMultiplier = Number(form.frequency) || 1;
      if (runningTotal > 0 && frequencyMultiplier !== 1) addLine('Frequency Adj.', -(runningTotal * (1 - frequencyMultiplier)));
    }

    let finalTotal = runningTotal;
    let minApplied = false;
    const hasScope = totalWindows > 0 || extras.screens > 0 || extras.tracks > 0 || extras.hardWater > 0 || extras.paintDebris > 0 || extras.ladderWork > 0 || extras.skylights > 0 || extras.lightFixture > 0 || addons.pressure > 0 || addons.gutter > 0 || addons.caulk > 0;
    if (hasScope && finalTotal > 0 && finalTotal < pricingConfig.minimumCharge) {
      addLine('Minimum charge adjustment', pricingConfig.minimumCharge - finalTotal);
      finalTotal = pricingConfig.minimumCharge;
      minApplied = true;
    }

    return {
      total: roundCurrency(finalTotal),
      lineItems,
      totalWindows,
      minApplied,
      hasScope,
      baseTotal: roundCurrency(preDiscountTotal)
    };
  }, [addonDetails, addons, extras, floors, form.condition, form.frequency, pricingConfig, propertyType, pressureServiceLabel, serviceLevel, windows, caulkScopeLabel]);

  const normalizedManualProposalLines = useMemo(() => normalizeManualProposalLines(manualProposalLines), [manualProposalLines]);
  const manualProposalPdfRows = useMemo(() => buildManualProposalPdfTableRows(manualProposalLines), [manualProposalLines]);
  const manualProposalLineTotal = useMemo(() => roundCurrency(getManualProposalLineTotal(manualProposalLines)), [manualProposalLines]);
  const manualProposalWarnings = useMemo(() => getManualProposalLineWarnings(manualProposalLines), [manualProposalLines]);
  const manualProposalWarningsByLine = useMemo(() => manualProposalWarnings.reduce((grouped, warning) => {
    if (!grouped[warning.lineId]) grouped[warning.lineId] = [];
    grouped[warning.lineId].push(warning.message);
    return grouped;
  }, {}), [manualProposalWarnings]);
  const manualProposalActive = useManualProposalLines;
  const manualTotalActive = !manualProposalActive && String(manualTotalOverride).trim() !== '';
  const finalEstimateTotal = manualProposalActive
    ? manualProposalLineTotal
    : manualTotalActive
      ? roundCurrency(Math.max(0, Number(manualTotalOverride) || 0))
      : estimateData.total;
  const nextCustomerNumber = useMemo(
    () => Math.max(...customers.map(c => Number(c.customerNumber) || 0), 0) + 1,
    [customers]
  );
  const selectedCustomer = useMemo(
    () => customers.find(c => String(c.id) === String(selectedCustomerId)) || null,
    [customers, selectedCustomerId]
  );
  const previewCustomer = useMemo(() => ({
    name: normalizeEstimateText(selectedCustomer?.name || form.name),
    address: normalizeEstimateText(selectedCustomer?.address || form.address),
    cityStateZip: normalizeEstimateText(form.cityStateZip || selectedCustomer?.cityStateZip || ''),
    phone: normalizeEstimateText(selectedCustomer?.phone || form.phone),
  }), [form.address, form.cityStateZip, form.name, form.phone, selectedCustomer]);
  const previewEstimateNumber = useMemo(() => {
    const rawNumber = estimateType === 'new'
      ? nextCustomerNumber
      : (Number(selectedCustomer?.customerNumber) || nextCustomerNumber);
    return String(rawNumber || 0).padStart(4, '0');
  }, [estimateType, nextCustomerNumber, selectedCustomer]);
  const estimateMessageReady = Boolean(
    previewCustomer.name
    && previewCustomer.address
    && (manualProposalActive ? manualProposalPdfRows.length > 0 : estimateData.lineItems.length > 0)
  );
  const estimateMessagePreview = useMemo(() => {
    if (!estimateMessageReady) {
      return 'Enter customer name, service address, and at least one selected service to generate the final copyable estimate message.';
    }
    const nextMessage = composeCustomerEstimateMessage({
      customerName: previewCustomer.name,
      streetAddress: previewCustomer.address,
      cityStateZip: previewCustomer.cityStateZip,
      phone: previewCustomer.phone,
      estimateNumber: previewEstimateNumber,
      estimateDate: new Date().toLocaleDateString('en-US'),
      estimateType,
      serviceLevel,
      windows,
      extras,
      addons,
      otherText: form.otherText,
      customerNotes: form.notes,
      manualProposalLines: manualProposalActive ? manualProposalLines : [],
      baseTotal: manualProposalActive ? finalEstimateTotal : estimateData.baseTotal,
      total: finalEstimateTotal,
    });
    return estimateType === 'new' && !addonDetails.newCustomerDiscountEnabled
      ? nextMessage.replace('New Customer Discount: 10% OFF New Customer', 'New Customer Discount: Not applied')
      : nextMessage;
  }, [addonDetails.newCustomerDiscountEnabled, addons, estimateData.baseTotal, estimateData.lineItems.length, estimateMessageReady, estimateType, extras, finalEstimateTotal, form.notes, form.otherText, manualProposalActive, manualProposalLines, previewCustomer, previewEstimateNumber, serviceLevel, windows]);
  const customerFieldsLocked = estimateType !== 'new';
  const customerSelectionActive = customerFieldsLocked && selectedCustomerId;
  const builderTravelRouteTone = builderTravelRoute.status === 'ready'
    ? 'var(--good)'
    : builderTravelRoute.status === 'error'
      ? 'var(--warn)'
      : 'var(--accent)';
  const builderTravelRouteMessage = builderTravelRoute.status === 'ready'
    ? `Round trip travel: ${builderTravelRoute.roundTripMiles.toFixed(1)} miles | ${builderTravelRoute.label}`
    : builderTravelRoute.status === 'loading'
      ? 'Calculating road travel...'
      : builderTravelRoute.status === 'waiting'
        ? 'Loading travel routing defaults...'
        : builderTravelRoute.status === 'error'
          ? builderTravelRoute.error
          : 'Enter the service address to auto-calculate round trip travel into Price Analysis.';
  const builderTravelRouteDetail = builderTravelRoute.status === 'ready'
    ? `One way: ${builderTravelRoute.oneWayMiles.toFixed(1)} miles${builderTravelRoute.durationMin > 0 ? ` | about ${builderTravelRoute.durationMin} minutes` : ''}`
    : builderTravelRoute.status === 'error'
      ? 'Price Analysis will stay editable so you can enter miles manually.'
      : 'The route uses Home -> Worker pickup -> Customer and doubles the road miles for round trip travel.';
  const setupFloorOptions = [
    { value: 1, label: 'Single-story' },
    { value: 2, label: 'Two-story' },
    { value: 3, label: 'Three-story' },
    { value: 4, label: 'Four-story' },
  ];
  const selectionButtonStyle = isActive => ({
    padding: '10px 14px',
    borderRadius: 8,
    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
    background: isActive ? 'rgba(79, 161, 255, 0.12)' : 'var(--panel-soft)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontWeight: isActive ? 700 : 500,
  });
  const counterButtonStyle = {
    minWidth: 32,
    height: 32,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--panel)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontWeight: 700,
  };
  const stepperInputStyle = {
    width: 90,
    padding: '8px',
    background: 'var(--panel)',
    color: 'var(--text)',
  };
  const countCardStyle = {
    background: 'var(--panel-soft)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px',
  };
  const coreExtraRowConfigs = [
    { key: 'screens', title: 'Screens', helper: 'Count each screen that needs cleaning.' },
    { key: 'tracks', title: 'Tracks', helper: 'Count each track section that needs detailing.' },
  ];
  const adjustmentRowConfigs = [
    {
      key: 'hardWater',
      title: 'Hard Water Removal',
      helper: `${Number(pricingConfig.adjustments.hardWater.multiplier) || 0}x avg selected window price / pane${hardWaterUnitRate > 0 ? ` (${money(hardWaterUnitRate)} est.)` : ''}`,
    },
    {
      key: 'paintDebris',
      title: 'Construction / Paint Removal',
      helper: `${money(pricingConfig.adjustments.paintDebris.flat)} each`,
    },
    {
      key: 'ladderWork',
      title: 'Ladder Access',
      helper: `${money(pricingConfig.adjustments.ladderWork.flat)} each`,
    },
    {
      key: 'skylights',
      title: 'Manual Skylight Cleaning',
      helper: `${money(pricingConfig.adjustments.manualSkylightCleaning.flat)} each`,
    },
    {
      key: 'lightFixture',
      title: 'Light Fixtures / Fans',
      helper: `${money(pricingConfig.adjustments.lightFixture.flat)} each`,
    },
  ];
  const renderSectionHeading = (number, title, subtitle = '') => (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: 0, color: 'var(--accent)' }}>{number}. {title}</h3>
      {subtitle && <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>{subtitle}</div>}
    </div>
  );
  const renderStepperRow = ({
    rowKey,
    title,
    helper,
    value,
    step = 1,
    onDecrease,
    onIncrease,
    onChange,
    footer = null,
  }) => {
    const count = Math.max(0, Number(value) || 0);
    return (
      <div key={rowKey} style={countCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontWeight: 700 }}>{title}</div>
            {helper && <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>{helper}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={counterButtonStyle} onClick={onDecrease} disabled={count <= 0}>-</button>
            <input
              type="number"
              min="0"
              step={step}
              value={count}
              onChange={event => onChange(Math.max(0, parseInt(event.target.value, 10) || 0))}
              style={stepperInputStyle}
            />
            <button type="button" style={counterButtonStyle} onClick={onIncrease}>+</button>
          </div>
        </div>
        {footer && <div style={{ marginTop: 10 }}>{footer}</div>}
      </div>
    );
  };
  const estimateQuoteConfidence = useMemo(() => {
    if (manualProposalActive) {
      return {
        level: 'manual',
        color: 'var(--accent)',
        text: 'Manual proposal mode - PDF and saved estimate total come from your entered line items.'
      };
    }
    const hasPaidAddons = addons.pressure > 0 || addons.gutter > 0 || addons.caulk > 0;
    if (!estimateData.hasScope || (estimateData.totalWindows <= 0 && !hasPaidAddons)) {
      return {
        level: 'low',
        color: 'var(--danger)',
        text: 'Low confidence - enter pane count or scope before quoting.'
      };
    }
    if (
      !String(form.name || '').trim()
      || !String(form.address || '').trim()
      || extras.hardWater > 0
      || extras.paintDebris > 0
      || extras.ladderWork > 0
      || floors >= 3
    ) {
      return {
        level: 'medium',
        color: 'var(--warn)',
        text: 'Medium confidence - usable phone quote, confirm details before scheduling.'
      };
    }
    return {
      level: 'high',
      color: 'var(--good)',
      text: 'High confidence - pane count and basic scope entered.'
    };
  }, [addons.caulk, addons.gutter, addons.pressure, estimateData.hasScope, estimateData.totalWindows, extras.hardWater, extras.ladderWork, extras.paintDebris, floors, form.address, form.name, manualProposalActive]);
  const manualProposalBlockingErrors = useMemo(() => {
    if (!manualProposalActive) return [];
    if (normalizedManualProposalLines.length === 0) {
      return ['Manual proposal lines need at least one service title and price.'];
    }
    const blockingErrors = [];
    const hasPricedLineWithoutTitle = normalizedManualProposalLines.some(line => line.hasAmount && !line.hasTitle);
    if (hasPricedLineWithoutTitle) {
      blockingErrors.push('Each priced manual proposal line must have a service title.');
    }
    const hasInvalidAmount = normalizedManualProposalLines.some(line => (line.hasTitle || line.hasDescription || line.hasAmount) && !line.isValidAmount);
    if (hasInvalidAmount) {
      blockingErrors.push('Manual proposal amounts must be valid numbers.');
    }
    if (!MANUAL_PROPOSAL_ALLOW_NEGATIVE_AMOUNTS && normalizedManualProposalLines.some(line => line.isValidAmount && line.amountValue < 0)) {
      blockingErrors.push('Manual proposal amounts cannot be negative.');
    }
    if (manualProposalPdfRows.length === 0) {
      blockingErrors.push('Manual proposal lines need at least one service title and price.');
    }
    if ((Number(manualProposalLineTotal) || 0) <= 0) {
      blockingErrors.push('Manual proposal total must be greater than $0.00.');
    }
    return Array.from(new Set(blockingErrors));
  }, [manualProposalActive, manualProposalLineTotal, manualProposalPdfRows.length, normalizedManualProposalLines]);
  const estimateGenerationErrors = useMemo(() => getEstimateGenerationErrors({
    estimateType,
    selectedCustomerId,
    form,
    estimateData,
    useManualProposalLines: manualProposalActive,
    manualTotalActive,
    manualTotalOverride,
    manualTotalReason
  }), [estimateData, estimateType, form, manualProposalActive, manualTotalActive, manualTotalOverride, manualTotalReason, selectedCustomerId]);
  const estimateGenerationBlockers = [...estimateGenerationErrors, ...manualProposalBlockingErrors];
  const quoteActionHint = estimateGenerationBlockers[0] || 'Complete the scope and customer details to generate the estimate.';
  const canGenerateEstimate = estimateGenerationBlockers.length === 0;
  const closePriceAnalysisModal = useCallback(() => setShowPriceAnalysisModal(false), []);
  const groupedEstimateLineItems = useMemo(() => {
    const grouped = new Map();
    (estimateData.lineItems || []).forEach(item => {
      const label = simplifyQuickEstimateLineItemLabel(item.label, serviceLevel);
      const groupKey = `${label}__${item.quoteOnly ? 'quote' : 'priced'}`;
      const existing = grouped.get(groupKey) || { label, amount: 0, quoteOnly: Boolean(item.quoteOnly), accent: Boolean(item.accent) };
      existing.amount = roundCurrency((Number(existing.amount) || 0) + (Number(item.amount) || 0));
      existing.accent = existing.accent || Boolean(item.accent);
      grouped.set(groupKey, existing);
    });
    return Array.from(grouped.values());
  }, [estimateData.lineItems, serviceLevel]);
  const estimateBuilderSnapshot = useMemo(() => ({
    revenue: finalEstimateTotal,
    calculatedRevenue: estimateData.total,
    hasRevenue: finalEstimateTotal > 0,
    hasScope: estimateData.hasScope,
    manualOverrideActive: manualTotalActive,
    estimateType,
    propertyType,
    customerName: form.name.trim(),
    address: form.address.trim(),
    routeAddress: effectiveRouteAddress,
    travelRouteStatus: builderTravelRoute.status,
    travelOneWayMiles: builderTravelRoute.oneWayMiles,
    travelRoundTripMiles: builderTravelRoute.roundTripMiles,
    travelDurationMin: builderTravelRoute.durationMin,
    travelRouteError: builderTravelRoute.error,
    travelRouteLabel: builderTravelRoute.label,
    label: form.name.trim() || 'Unsaved estimate builder quote',
  }), [
    builderTravelRoute.durationMin,
    builderTravelRoute.error,
    builderTravelRoute.label,
    builderTravelRoute.oneWayMiles,
    builderTravelRoute.roundTripMiles,
    builderTravelRoute.status,
    effectiveRouteAddress,
    estimateData.hasScope,
    estimateData.total,
    estimateType,
    finalEstimateTotal,
    form.address,
    form.name,
    manualTotalActive,
    propertyType,
  ]);

  useEffect(() => {
    onProfitSnapshotChange(estimateBuilderSnapshot);
  }, [estimateBuilderSnapshot, onProfitSnapshotChange]);

  useEffect(() => {
    setCopyStatus('');
  }, [estimateMessagePreview]);

  useEffect(() => {
    if (!manualTotalActive && manualTotalReason) {
      setManualTotalReason('');
    }
  }, [manualTotalActive, manualTotalReason]);
  useEffect(() => {
    if (!showPriceAnalysisModal) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') closePriceAnalysisModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closePriceAnalysisModal, showPriceAnalysisModal]);

  const handleInputChange = e => {
    const { name, value } = e.target;
    const nextValue = name === 'name' || name === 'address'
      ? smartTitleCase(value)
      : value;
    setForm(prev => ({ ...prev, [name]: nextValue }));
  };
  const updateExtraCount = (type, delta) => setExtras(prev => ({ ...prev, [type]: Math.max(0, (Number(prev[type]) || 0) + delta) }));
  const updateAddonDetailCount = (key, delta) => updateEstimateAddonDetails(setAddonDetails, prev => ({
    [key]: Math.max(0, (Number(prev[key]) || 0) + delta)
  }));
  const applyFrequencyDiscountKey = nextKey => {
    const resolvedKey = String(nextKey || 'oneTime');
    updateEstimateAddonDetails(setAddonDetails, prev => ({
      frequencyDiscountEnabled: resolvedKey !== 'oneTime',
      frequencyDiscountKey: resolvedKey === 'oneTime' ? '' : resolvedKey
    }));
  };
  const handleFrequencyDiscountToggle = enabled => {
    if (!enabled) {
      updateEstimateAddonDetails(setAddonDetails, {
        frequencyDiscountEnabled: false,
        frequencyDiscountKey: ''
      });
      return;
    }
    const hintKey = repeatLocationPricingHint.recommendedKey;
    const safeRecommended = ['monthly', 'quarterly'].includes(hintKey) ? hintKey : 'monthly';
    updateEstimateAddonDetails(setAddonDetails, prev => {
      const prevKey = prev.frequencyDiscountKey;
      const safeKey = ['monthly', 'quarterly'].includes(prevKey) ? prevKey : safeRecommended;
      return { frequencyDiscountEnabled: true, frequencyDiscountKey: safeKey };
    });
  };
  const handleManualProposalModeToggle = enabled => {
    const shouldEnable = Boolean(enabled);
    setUseManualProposalLines(shouldEnable);
    if (shouldEnable) {
      setManualTotalOverride('');
      setManualTotalReason('');
      setManualProposalLines(prev => prev.length > 0 ? prev : [createManualProposalLine()]);
      return;
    }
  };
  const updateManualProposalLine = (lineId, field, value) => {
    setManualProposalLines(prev => prev.map(line => (
      line.id === lineId
        ? { ...line, [field]: value }
        : line
    )));
  };
  const addManualProposalLine = (overrides = {}) => {
    setManualProposalLines(prev => [...prev, createManualProposalLine(overrides)]);
  };
  const removeManualProposalLine = lineId => {
    setManualProposalLines(prev => prev.filter(line => line.id !== lineId));
  };

  const handleClearAll = () => {
    if (!confirm('Reset quote inputs and totals?')) return;
    setWindows(() => ({ doubleHung: 0, smallPane: 0, casement: 0, slider: 0, picture: 0, patio: 0, storm: 0, skylight: 0 }));
    setExtras(() => ({ screens: 0, tracks: 0, hardWater: 0, paintDebris: 0, ladderWork: 0, skylights: 0, lightFixture: 0 }));
    setAddons(prev => ({ ...prev, pressure: 0, gutter: 0, caulk: 0 }));
    setAddonDetails(() => buildDefaultEstimateAddonDetails(estimateType));
    setFloors(2);
    setServiceLevel('both');
    setForm(prev => ({ ...prev, frequency: '1.0', condition: '1.0', notes: '', otherText: '' }));
    setManualTotalOverride('');
    setManualTotalReason('');
    setUseManualProposalLines(false);
    setManualProposalLines([]);
    setCopyStatus('');
    setError('');
    setNewCustomerDiscountTouched(false);
  };

  const handleTypeChange = e => {
    const nextEstimateType = e.target.value;
    setEstimateType(nextEstimateType);
    setSelectedCustomerId('');
    setForm({ name: '', address: '', cityStateZip: '', phone: '', email: '', frequency: '1.0', condition: '1.0', notes: '', otherText: '' });
    setWindows(() => ({ doubleHung: 0, smallPane: 0, casement: 0, slider: 0, picture: 0, patio: 0, storm: 0, skylight: 0 }));
    setExtras(() => ({ screens: 0, tracks: 0, hardWater: 0, paintDebris: 0, ladderWork: 0, skylights: 0, lightFixture: 0 }));
    setAddons(prev => ({ ...prev, pressure: 0, gutter: 0, caulk: 0 }));
    setAddonDetails(() => buildDefaultEstimateAddonDetails(nextEstimateType));
    setError('');
    setManualTotalOverride('');
    setManualTotalReason('');
    setUseManualProposalLines(false);
    setManualProposalLines([]);
    setNewCustomerDiscountTouched(false);
  };

  const handleExistingCustomerSelect = e => {
    const id = e.target.value;
    setSelectedCustomerId(id);
    const customer = customers.find(c => String(c.id) === String(id));
    if (!customer) return;
    setForm(prev => ({ ...prev, name: customer.name || '', address: customer.address || '', cityStateZip: customer.cityStateZip || '', phone: customer.phone || '', email: customer.email || '' }));
  };

  const handleCopyEstimateMessage = async () => {
    if (!estimateMessageReady) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(estimateMessagePreview);
      } else if (estimateMessageRef.current && typeof document.execCommand === 'function') {
        estimateMessageRef.current.focus();
        estimateMessageRef.current.select();
        const copied = document.execCommand('copy');
        estimateMessageRef.current.setSelectionRange(0, 0);
        if (!copied) throw new Error('Copy command was blocked.');
      } else {
        throw new Error('Clipboard is unavailable.');
      }
      setCopyStatus('Estimate message copied.');
    } catch {
      setCopyStatus('Clipboard access failed. Copy the message manually from the preview.');
    }
  };

  const handleGenerateEstimate = async () => {
    const generationErrors = getEstimateGenerationErrors({
      estimateType,
      selectedCustomerId,
      form,
      estimateData,
      useManualProposalLines: manualProposalActive,
      manualTotalActive,
      manualTotalOverride,
      manualTotalReason
    });
    generationErrors.push(...manualProposalBlockingErrors);

    if (generationErrors.length) {
      setError(generationErrors.join(' '));
      return;
    }

    setError('');
    setIsProcessing(true);

    try {
      let targetCustomer = null;

      if (estimateType === 'new') {
        const payload = { name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim(), email: form.email.trim(), cityStateZip: form.cityStateZip.trim(), status: 'Lead', notes: form.notes || '', customerNumber: nextCustomerNumber };
        const fallbackCustomer = { id: uid(), ...payload, email: form.email.trim(), cityStateZip: form.cityStateZip.trim() };
        let createdCustomer = null;
        try {
          if (estimateApiFetch) createdCustomer = await estimateApiFetch('/api/v1/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } catch { /* persist failed â€” use in-memory fallback so print still opens */ }
        targetCustomer = { ...fallbackCustomer, ...(createdCustomer || {}), email: form.email.trim(), cityStateZip: form.cityStateZip.trim() };
        setCustomers(prev => {
          const exists = prev.some(c => String(c.id) === String(targetCustomer.id));
          if (exists) return prev.map(c => String(c.id) === String(targetCustomer.id) ? { ...c, ...targetCustomer } : c);
          return [...prev, targetCustomer];
        });
      } else {
        if (!selectedCustomerId) throw new Error('Please select an existing customer.');
        const existingCustomer = customers.find(c => String(c.id) === String(selectedCustomerId));
        if (!existingCustomer) throw new Error('Selected customer could not be found.');
        targetCustomer = { ...existingCustomer, name: form.name || existingCustomer.name || '', address: form.address || existingCustomer.address || '', phone: form.phone || existingCustomer.phone || '', email: form.email || existingCustomer.email || '', cityStateZip: form.cityStateZip || existingCustomer.cityStateZip || '' };
      }

      const estimateNumber = String(targetCustomer.customerNumber || '0000').padStart(4, '0');

      const lineItemSummary = estimateData.lineItems
        .map(item => `${item.label}: ${item.quoteOnly ? 'Quote Separately' : money(Math.abs(item.amount))}`)
        .join('\n');
      const addonAuditNotes = [
        addonDetails.pressureSurfaceNotes.trim()
          ? `${pressureServiceLabel} Notes: ${addonDetails.pressureSurfaceNotes.trim()}`
          : '',
        isFrequencyDiscountActive
          ? `Frequency Pricing Selection: ${selectedFrequencyDiscountOption.label}`
          : '',
      ].filter(Boolean);
      const manualProposalNotesBlock = manualProposalActive
        ? buildManualProposalNotesBlock(manualProposalLines)
        : '';
      const notesParts = [
        `Estimate #${estimateNumber}`,
        lineItemSummary,
        addonAuditNotes.join('\n'),
        manualTotalActive ? `Manual Override: ${money(finalEstimateTotal)}\nOverride Reason: ${String(manualTotalReason || '').trim()}` : '',
        manualProposalNotesBlock
      ].filter(Boolean);

      // Save an Estimate-status service job so it appears in the Jobs tab and provides a paper trail
      const jobPayload = {
        customerId: String(targetCustomer.id),
        address: targetCustomer.address || form.address || '',
        serviceType: estimateServiceSelection.serviceTypeLabel,
        serviceCategory: propertyType === 'com' ? 'Inside/Outside' : '',
        frequency: '',
        quotedAmount: finalEstimateTotal,
        actualAmount: 0,
        overheadSpent: 0,
        status: 'Estimate',
        paymentStatus: 'Unpaid',
        invoiceSent: false,
        scheduledDate: toLocalISODate(),
        assignedEmployeeIds: [],
        notes: notesParts.join('\n'),
        gcalEventId: '',
      };
      let createdJob = null;
      try {
        if (estimateApiFetch) {
          createdJob = await estimateApiFetch('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobPayload) });
        }
      } catch { /* job save failed â€” print still opens, estimate is not lost */ }
      if (setServiceJobs) {
        const newJob = withJobFinancialDefaults(createdJob || { id: uid(), jobNumber: Math.max(...serviceJobs.map(j => Number(j.jobNumber) || 0), 0) + 1, ...jobPayload });
        setServiceJobs(prev => [...prev, newJob]);
      }

      const displayCustomer = {
        name: targetCustomer?.name || form.name,
        address: targetCustomer?.address || form.address,
        cityStateZip: form.cityStateZip || targetCustomer?.cityStateZip || '',
        phone: targetCustomer?.phone || form.phone,
        email: targetCustomer?.email || form.email,
      };
      const estimateDateObject = new Date();
      const estimateDate = estimateDateObject.toLocaleDateString('en-US');
      const validUntilDate = getEstimateValidUntilDateForType(estimateType, estimateDateObject);
      const useManualProposalPdfRows = manualProposalActive && manualProposalPdfRows.length > 0;

      await generateReceiptPDF({
        id: estimateNumber,
        date: estimateDate,
        validUntilDate,
        customerName: displayCustomer.name,
        address: displayCustomer.address,
        cityStateZip: displayCustomer.cityStateZip,
        phone: displayCustomer.phone,
        email: displayCustomer.email,
        notes: form.notes,
        locationList: '',
        total: finalEstimateTotal,
        receivedBy: '',
        services: estimateServiceSelection.selectedServices,
        otherServiceText: estimateServiceSelection.otherServiceText,
        continueOnAttachment: false,
        documentType: 'estimate',
        duplicateCopies: false,
        documentTitle: 'SERVICE ESTIMATE',
        estimateType,
        baseTotal: useManualProposalPdfRows ? finalEstimateTotal : estimateData.baseTotal,
        taxAmount: 0,
        estimateLineItems: estimateData.lineItems,
        serviceLevel,
        windows: { ...windows },
        extras: { ...extras },
        addons: { ...addons },
        otherText: form.otherText,
        customerNotes: form.notes,
        ...(useManualProposalPdfRows ? {
          estimateTableRows: manualProposalPdfRows,
          estimateAdjustmentLines: [],
          hideEstimateSubtotal: true,
        } : {}),
      });
    } catch (err) {
      setError(err?.message || 'Failed to generate estimate.');
    } finally {
      setIsProcessing(false);
    }
  };

  const quickCustomerDetailsCard = (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Customer Details for Saving / PDF</h3>
      <div className="small" style={{ color: 'var(--muted)', marginBottom: 16 }}>
        Name and service address are required before saving or printing a new-customer estimate. Phone and email stay optional.
      </div>
      {(estimateType === 'existing' || estimateType === 'commercial') && (
        <div className="modal-field" style={{ marginBottom: '16px' }}>
          <label>Select Customer <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>(fields below auto-fill from selection)</span></label>
          <select value={selectedCustomerId} onChange={handleExistingCustomerSelect} style={{ padding: '12px', width: '100%', background: 'var(--panel-soft)', color: 'var(--text)' }}>
            <option value="">Search / Select Customer</option>
            {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name} - {customer.address}</option>)}
          </select>
        </div>
      )}
      <div className="modal-field">
        <label>Name / Company <span style={{ color: 'var(--danger)' }}>*</span>{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
        <input type="text" name="name" value={form.name} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Name / Company" style={{ padding: '10px' }} />
      </div>
      <div className="modal-field">
        <label>Service Address <span style={{ color: 'var(--danger)' }}>*</span>{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
        <input type="text" name="address" value={form.address} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Service Address" style={{ padding: '10px' }} />
      </div>
      <div className="modal-field">
        <label>City, State, ZIP{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
        <input type="text" name="cityStateZip" value={form.cityStateZip} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="City, State, ZIP" style={{ padding: '10px' }} />
      </div>
      <div style={{ marginTop: -2, marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--panel)', border: `1px solid ${builderTravelRouteTone}` }}>
        <div style={{ fontWeight: 700, color: builderTravelRouteTone }}>{builderTravelRouteMessage}</div>
        <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>{builderTravelRouteDetail}</div>
      </div>
      <div className="row" style={{ gap: '12px' }}>
        <div className="modal-field" style={{ flex: 1 }}>
          <label>Phone{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
          <input type="text" name="phone" value={form.phone} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Phone" style={{ padding: '10px' }} />
        </div>
        <div className="modal-field" style={{ flex: 1 }}>
          <label>Email{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
          <input type="text" name="email" value={form.email} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Email" style={{ padding: '10px' }} />
        </div>
      </div>
      <div className="row" style={{ marginTop: '20px', gap: '12px' }}>
        <div className="modal-field" style={{ flex: 1 }}>
          <label>Job Notes</label>
          <textarea name="notes" value={form.notes} onChange={handleInputChange} rows="2" style={{ padding: '10px' }} placeholder="Notes..." />
        </div>
        <div className="modal-field" style={{ flex: 1 }}>
          <label>Other Services (Custom text)</label>
          <textarea name="otherText" value={form.otherText} onChange={handleInputChange} rows="2" style={{ padding: '10px' }} placeholder="Chandeliers, etc..." />
        </div>
      </div>
    </section>
  );

  const estimateAddOnControls = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={countCardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Pressure / Soft Washing</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" onClick={() => updateEstimateAddonDetails(setAddonDetails, { pressureMode: 'power' })} style={selectionButtonStyle(addonDetails.pressureMode === 'power')}>Power Washing</button>
          <button type="button" onClick={() => updateEstimateAddonDetails(setAddonDetails, { pressureMode: 'soft' })} style={selectionButtonStyle(addonDetails.pressureMode === 'soft')}>Soft Washing</button>
        </div>
        {renderStepperRow({
          rowKey: 'pressure-area',
          title: 'Surface Areas',
          helper: 'Count each 6 ft x 6 ft area as 1 unit. Example: a 12 ft x 6 ft section = 2 units.',
          value: pressureAreaUnits,
          onDecrease: () => updateAddonDetailCount('pressureAreaUnits', -1),
          onIncrease: () => updateAddonDetailCount('pressureAreaUnits', 1),
          onChange: next => updateEstimateAddonDetails(setAddonDetails, { pressureAreaUnits: next }),
          footer: (
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="small" style={{ color: 'var(--muted)' }}>{pressureAreaLabel}</div>
              {addonDetails.pressureMode === 'soft' && (
                <div className="small" style={{ color: 'var(--warn)' }}>
                  Soft washing includes a 40% chemical, safety, and labor adjustment.
                </div>
              )}
            </div>
          ),
        })}
        <div className="modal-field" style={{ marginBottom: 0, marginTop: 12 }}>
          <label>Surface Notes <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>(optional)</span></label>
          <textarea
            value={addonDetails.pressureSurfaceNotes}
            onChange={e => updateEstimateAddonDetails(setAddonDetails, { pressureSurfaceNotes: e.target.value })}
            rows="2"
            placeholder="Fence line, siding, patio wall, garage door, etc."
            style={{ padding: '10px' }}
          />
        </div>
      </div>

      <div style={countCardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Gutter Cleaning</div>
        {renderStepperRow({
          rowKey: 'gutter-sections',
          title: 'Gutter Sections',
          helper: 'Count each continuous gutter run as 1 section. Example: front, back, left side, right side = 4 sections.',
          value: gutterSections,
          onDecrease: () => updateAddonDetailCount('gutterSections', -1),
          onIncrease: () => updateAddonDetailCount('gutterSections', 1),
          onChange: next => updateEstimateAddonDetails(setAddonDetails, { gutterSections: next }),
          footer: <div className="small" style={{ color: 'var(--muted)' }}>If the customer is unsure, ask whether gutters are front only, back only, full house, or detached garage too.</div>,
        })}
      </div>

      <div style={countCardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Caulking / Sealing</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" onClick={() => updateEstimateAddonDetails(setAddonDetails, { caulkMode: 'window' })} style={selectionButtonStyle(addonDetails.caulkMode === 'window')}>Window Count</button>
          <button type="button" onClick={() => updateEstimateAddonDetails(setAddonDetails, { caulkMode: 'surfaceJoint' })} style={selectionButtonStyle(addonDetails.caulkMode === 'surfaceJoint')}>Surface Joint Count</button>
        </div>
        {renderStepperRow({
          rowKey: 'caulk-raw-count',
          title: addonDetails.caulkMode === 'surfaceJoint' ? 'Surface Joints' : 'Windows to Seal',
          helper: addonDetails.caulkMode === 'surfaceJoint'
            ? 'Count the surface joints to seal. Each surface joint bills as 3 units.'
            : 'Count the windows that need sealing work.',
          value: caulkRawCount,
          onDecrease: () => updateAddonDetailCount('caulkRawCount', -1),
          onIncrease: () => updateAddonDetailCount('caulkRawCount', 1),
          onChange: next => updateEstimateAddonDetails(setAddonDetails, { caulkRawCount: next }),
          footer: (
            <div className="small" style={{ color: 'var(--muted)' }}>
              {addonDetails.caulkMode === 'surfaceJoint'
                ? `Billable units: ${caulkRawCount} surface joint${caulkRawCount === 1 ? '' : 's'} x 3 = ${caulkBillableUnits}`
                : `Billable units: ${caulkBillableUnits} window${caulkBillableUnits === 1 ? '' : 's'}`}
            </div>
          ),
        })}
      </div>
    </div>
  );
  const manualProposalModePanel = (
    <div style={{ marginTop: '18px', padding: '14px', borderRadius: 10, background: 'var(--panel)', border: `1px solid ${manualProposalActive ? 'var(--accent)' : 'var(--border)'}` }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={manualProposalActive}
          onChange={e => handleManualProposalModeToggle(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Manual Proposal Line Items</div>
          <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>
            Use this when you want the estimate PDF to show manually entered services and prices instead of calculator-generated service rows. Manual proposal lines affect this estimate only. They do not change default pricing.
          </div>
        </div>
      </label>

      <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
        <div className="small" style={{ color: 'var(--muted)' }}>Calculator Estimate mode uses the pricing engine.</div>
        <div className="small" style={{ color: 'var(--muted)' }}>Manual Proposal mode uses your entered line items.</div>
        <div className="small" style={{ color: 'var(--muted)' }}>Manual proposal lines affect this estimate only.</div>
        <div className="small" style={{ color: 'var(--muted)' }}>Calculator rows are internal only and will not print while Manual Proposal mode is enabled.</div>
        <div className="small" style={{ color: 'var(--muted)' }}>Manual Proposal mode is the recommended path for commercial, high-rise, unusual, or custom-scope bids.</div>
      </div>

      {manualProposalActive && (
        <div style={{ marginTop: 14 }}>
          <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--accent)', background: 'rgba(79, 161, 255, 0.08)', color: 'var(--text)' }}>
            <div style={{ fontWeight: 700, color: 'var(--accent)' }}>PDF will use manual proposal lines. Calculator rows are internal only and will not print.</div>
            <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>Discounts in Manual Proposal mode should be entered as visible line items if you want them shown on the PDF.</div>
            {MANUAL_PROPOSAL_ALLOW_NEGATIVE_AMOUNTS && (
              <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>Use negative amounts only for visible customer-facing discounts or credits.</div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Customer-Facing Proposal Lines</div>
              <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>
                Service title: recommended under {MANUAL_PROPOSAL_RECOMMENDED_TITLE_LENGTH} characters. Description / notes: recommended under {MANUAL_PROPOSAL_RECOMMENDED_DESCRIPTION_LENGTH} characters.
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => addManualProposalLine()}>
              Add Line
            </button>
          </div>

          {manualProposalLines.length === 0 ? (
            <div className="small" style={{ color: 'var(--muted)', marginTop: 14 }}>
              Add at least one manual proposal line before generating the estimate PDF.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
              {manualProposalLines.map((line, index) => {
                const normalizedLine = normalizeManualProposalLines([line])[0] || {
                  hasTitle: false,
                  hasDescription: false,
                  hasAmount: String(line?.amount ?? '').trim() !== '',
                  isValidAmount: false,
                };
                const rowWarnings = manualProposalWarningsByLine[line.id] || [];
                const rowHasBlockingIssue = Boolean(
                  (normalizedLine.hasAmount && !normalizedLine.hasTitle)
                  || ((normalizedLine.hasTitle || normalizedLine.hasDescription || normalizedLine.hasAmount) && !normalizedLine.isValidAmount)
                );
                return (
                  <div key={line.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700 }}>Manual Proposal Line {index + 1}</div>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => removeManualProposalLine(line.id)}>
                        Remove Line
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.1fr) minmax(220px, 1.6fr) minmax(120px, 0.7fr)', gap: 10 }}>
                      <div className="modal-field" style={{ marginBottom: 0 }}>
                        <label>Service Title</label>
                        <input
                          type="text"
                          value={line.title}
                          onChange={e => updateManualProposalLine(line.id, 'title', e.target.value)}
                          placeholder="Enter customer-facing service title"
                          style={{ padding: '10px' }}
                        />
                        <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>Recommended under {MANUAL_PROPOSAL_RECOMMENDED_TITLE_LENGTH} characters.</div>
                      </div>
                      <div className="modal-field" style={{ marginBottom: 0 }}>
                        <label>Description / Notes</label>
                        <input
                          type="text"
                          value={line.description}
                          onChange={e => updateManualProposalLine(line.id, 'description', e.target.value)}
                          placeholder="Optional customer-facing description or scope note"
                          style={{ padding: '10px' }}
                        />
                        <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>Recommended under {MANUAL_PROPOSAL_RECOMMENDED_DESCRIPTION_LENGTH} characters.</div>
                      </div>
                      <div className="modal-field" style={{ marginBottom: 0 }}>
                        <label>Amount</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.amount}
                          onChange={e => updateManualProposalLine(line.id, 'amount', e.target.value)}
                          placeholder="0.00"
                          style={{ padding: '10px' }}
                        />
                        <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>
                          {MANUAL_PROPOSAL_ALLOW_NEGATIVE_AMOUNTS ? 'Negative amounts are allowed for visible discounts or credits.' : 'Enter a valid positive amount.'}
                        </div>
                      </div>
                    </div>
                    {rowHasBlockingIssue && (
                      <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>
                        {normalizedLine.hasAmount && !normalizedLine.hasTitle
                          ? 'Each priced manual proposal line must have a service title.'
                          : 'Manual proposal amounts must be valid numbers.'}
                      </div>
                    )}
                    {rowWarnings.length > 0 && (
                      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                        {rowWarnings.map(message => (
                          <div key={`${line.id}-${message}`} className="small" style={{ color: 'var(--warn)' }}>
                            {message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
            <div className="small" style={{ color: manualProposalLineTotal > 0 ? 'var(--muted)' : 'var(--warn)' }}>
              Manual Proposal Total: {money(manualProposalLineTotal)}
            </div>
            <div className="small" style={{ color: 'var(--muted)' }}>
              Saved quoted amount and PDF total will match this total.
            </div>
          </div>

          {manualProposalBlockingErrors.length > 0 && (
            <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>
              {manualProposalBlockingErrors.map(message => (
                <div key={message} style={{ fontSize: 12, color: 'var(--warn)' }}>
                  {message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const liveEstimatePanel = (
    <section className="card" style={{ border: '2px solid var(--accent)', background: 'var(--panel-soft)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px' }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 4, color: 'var(--accent)' }}>8. Live Estimate Panel</h3>
          <div className="small" style={{ color: 'var(--muted)' }}>Live pricing, discounts, overrides, and customer-ready estimate copy.</div>
        </div>
        <div style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--panel)', border: '1px solid var(--border)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
          Estimate Engine
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '16px' }}>
        <div>
          <div className="small" style={{ color: 'var(--muted)' }}>Estimated Total</div>
          <div style={{ fontSize: '30px', fontWeight: 800, color: 'var(--good)' }}>{money(finalEstimateTotal)}</div>
          {manualProposalActive
            ? <div className="small" style={{ color: 'var(--muted)' }}>Calculator total: {money(estimateData.total)} internal only</div>
            : manualTotalActive && <div className="small" style={{ color: 'var(--muted)' }}>Calculated total: {money(estimateData.total)}</div>}
        </div>
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--panel)', border: `1px solid ${estimateQuoteConfidence.color}`, minWidth: 220 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: estimateQuoteConfidence.color, textTransform: 'uppercase' }}>{estimateQuoteConfidence.level} confidence</div>
          <div className="small" style={{ color: 'var(--text)', marginTop: 4 }}>{estimateQuoteConfidence.text}</div>
        </div>
      </div>

      <div style={{ background: 'var(--panel)', padding: '16px', borderRadius: '8px', minHeight: '150px' }}>
        {manualProposalActive && (
          <div className="small" style={{ color: 'var(--muted)', marginBottom: 12 }}>
            Calculator rows are internal only while Manual Proposal Line Items is enabled.
          </div>
        )}
        {groupedEstimateLineItems.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '40px' }}>
            {manualProposalActive
              ? 'Manual proposal lines control the customer-facing estimate. Add calculator scope only if you want internal reference pricing.'
              : 'Add pane counts or service scope to generate a quote.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
            {groupedEstimateLineItems.map((item, index) => (
              <div key={`${item.label}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: item.accent ? '#ff6b6b' : (item.amount < 0 ? 'var(--good)' : 'var(--text)') }}>
                <span>{item.label}</span>
                <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{item.quoteOnly ? 'Quote Sep.' : `${item.amount < 0 ? '-' : ''}${money(Math.abs(item.amount))}`}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {manualProposalActive ? (
        <div style={{ marginTop: '16px', padding: '12px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700 }}>Manual total override is disabled because Manual Proposal Line Items already control the estimate total.</div>
        </div>
      ) : (
        <>
          <div className="modal-field" style={{ marginTop: '16px' }}>
            <label>Final Price Override <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>(optional)</span></label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualTotalOverride}
                onChange={e => setManualTotalOverride(e.target.value)}
                placeholder={estimateData.total > 0 ? String(estimateData.total.toFixed(2)) : '0.00'}
                style={{ padding: '10px', width: '100%', background: 'var(--panel)', color: 'var(--text)' }}
              />
              {manualTotalActive && (
                <button type="button" className="btn btn-sm" onClick={() => { setManualTotalOverride(''); setManualTotalReason(''); }} style={{ whiteSpace: 'nowrap' }}>
                  Use Calculated
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              {manualTotalActive
                ? `The printed estimate and saved quote will use ${money(finalEstimateTotal)}.`
                : 'Leave blank to use the calculated total from the live estimate engine.'}
            </div>
          </div>

          {manualTotalActive && (
            <div className="modal-field" style={{ marginTop: '16px' }}>
              <label>Override Reason</label>
              <textarea
                value={manualTotalReason}
                onChange={e => setManualTotalReason(e.target.value)}
                rows="2"
                placeholder="Example: matched prior customer price, owner-approved discount, site condition adjustment."
                style={{ padding: '10px' }}
              />
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: '18px', padding: '14px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Pricing Controls</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={addonDetails.newCustomerDiscountEnabled}
            onChange={e => {
              setNewCustomerDiscountTouched(true);
              updateEstimateAddonDetails(setAddonDetails, { newCustomerDiscountEnabled: e.target.checked });
            }}
          />
          New Customer Discount - 10% OFF
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={addonDetails.seniorDiscountEnabled}
            onChange={e => updateEstimateAddonDetails(setAddonDetails, { seniorDiscountEnabled: e.target.checked })}
          />
          Senior Discount - 5% OFF
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={isFrequencyDiscountActive}
            onChange={e => handleFrequencyDiscountToggle(e.target.checked)}
          />
          Frequency / Repeat Location Discount
        </label>
        <div className="small" style={{ color: repeatLocationPricingHint.recommendedKey ? 'var(--warn)' : 'var(--muted)', marginTop: 10 }}>
          {repeatLocationPricingHint.message || 'Enter the service address to check repeat pricing.'}
          {repeatLocationPricingHint.lastServiceDateLabel ? ` Last service: ${repeatLocationPricingHint.lastServiceDateLabel}.` : ''}
        </div>
        {!isFrequencyDiscountActive && ['monthly', 'quarterly'].includes(repeatLocationPricingHint.recommendedKey) && (
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => {
              handleFrequencyDiscountToggle(true);
              applyFrequencyDiscountKey(repeatLocationPricingHint.recommendedKey);
            }}
          >
            Enable Recommended {estimateFrequencyDiscountOptions.find(option => option.key === repeatLocationPricingHint.recommendedKey)?.label || 'Pricing'}
          </button>
        )}
        {isFrequencyDiscountActive && (
          <div className="modal-field" style={{ marginBottom: 0, marginTop: 12 }}>
            <label>Frequency / Repeat Pricing</label>
            <select
              value={visibleFrequencyDiscountKey}
              onChange={e => applyFrequencyDiscountKey(e.target.value)}
              style={{ padding: '10px', width: '100%', background: 'var(--panel-soft)', color: 'var(--text)' }}
            >
              {estimateFrequencyDiscountOptions.filter(o => ESTIMATE_SELECTABLE_FREQUENCY_KEYS.includes(o.key)).map(option => <option key={option.key} value={option.key}>{detailedFrequencyLabels[option.key] || option.label}</option>)}
            </select>
            {['monthly', 'quarterly'].includes(repeatLocationPricingHint.recommendedKey) && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => {
                  handleFrequencyDiscountToggle(true);
                  applyFrequencyDiscountKey(repeatLocationPricingHint.recommendedKey);
                }}
              >
                Use Recommended {estimateFrequencyDiscountOptions.find(option => option.key === repeatLocationPricingHint.recommendedKey)?.label || 'Pricing'}
              </button>
            )}
            <div className="small" style={{ color: 'var(--muted)', marginTop: 10 }}>
              Monthly (10% off) and Quarterly (5% off) adjust the estimate total. Semi-Annual and Annual are scheduling/reference labels only â€” they do not change the estimate total. Record service frequency in job or customer notes if needed.
            </div>
          </div>
        )}
        {manualProposalActive && (
          <div className="small" style={{ color: 'var(--muted)', marginTop: 10 }}>
            Discounts in Manual Proposal mode should be entered as visible line items if you want them shown on the PDF.
          </div>
        )}
      </div>

      {estimateData.minApplied && !manualTotalActive && !manualProposalActive && <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--warn)', marginTop: '4px' }}>* Minimum charge applied</div>}

      {manualProposalModePanel}

      <div className="modal-field" style={{ marginTop: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: 8 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>Customer Estimate Message</label>
            <div className="small" style={{ color: 'var(--muted)' }}>Single SMS/email-ready output. No duplicate receipt-style text version.</div>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleCopyEstimateMessage}
            disabled={!estimateMessageReady}
            style={{ whiteSpace: 'nowrap' }}
          >
            Copy Message
          </button>
        </div>
        <textarea
          ref={estimateMessageRef}
          readOnly
          value={estimateMessagePreview}
          rows={18}
          style={{
            padding: '12px',
            resize: 'vertical',
            background: 'var(--panel)',
            color: 'var(--text)',
            width: '100%',
            fontSize: '13px',
            lineHeight: 1.45,
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        />
        <div className="small" style={{ marginTop: 6, color: copyStatus ? 'var(--accent)' : 'var(--muted)' }}>
          {copyStatus || 'The message updates live as you change customer details and selected services.'}
        </div>
      </div>
      <div className="small" style={{ color: 'var(--muted)', marginTop: 10 }}>
        Price Analysis reads the current estimate total and travel miles from this calculator automatically.
      </div>

      <button className="btn btn-accent" style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: 'bold', marginTop: '24px', borderRadius: '8px' }} onClick={handleGenerateEstimate} disabled={isProcessing || !canGenerateEstimate}>
        {isProcessing ? 'Processing & Saving...' : 'Generate Print/PDF Estimate'}
      </button>
      {!isProcessing && !canGenerateEstimate && (
        <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8, textAlign: 'center' }}>
          {quoteActionHint}
        </div>
      )}
    </section>
  );

  const builderPriceAnalysisModal = showPriceAnalysisModal && (
    <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) closePriceAnalysisModal(); }}>
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-labelledby="estimate-price-analysis-title" onClick={event => event.stopPropagation()}>
        <div className="modal-header" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div className="pill">Unit Economics</div>
            <h3 id="estimate-price-analysis-title" style={{ marginTop: 8, marginBottom: 8, fontSize: 22 }}>Price Analysis</h3>
            <div className="sub">Quote jobs on the road using your spreadsheet pricing and print format.</div>
          </div>
          <button className="modal-close" aria-label="Close price analysis" onClick={closePriceAnalysisModal}>&times;</button>
        </div>
        <PriceAnalysisWorkspace
          customers={customers}
          serviceJobs={serviceJobs}
          estimateBuilderSnapshot={estimateBuilderSnapshot}
          mode="modal"
          initialRevenueSource={estimateBuilderSnapshot.hasRevenue ? 'builder' : null}
          showPageHeader={false}
        />
      </div>
    </div>
  );
  const builderHeader = (
    <div className="title-row" style={{ marginBottom: '24px' }}>
      <div>
        <div className="pill">Sales Module</div>
        <h2>Estimate Calculator</h2>
        <div className="sub">Quote jobs on the road using your spreadsheet pricing and print format.</div>
        {pricingLoadError && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warn)' }}>{pricingLoadError}</div>}
      </div>
      <div className="flex-row" style={{ alignItems: 'center', gap: 10 }}>
        <button type="button" className="topbar-item active" onClick={() => setShowPriceAnalysisModal(true)}>
          Price Analysis
        </button>
      </div>
    </div>
  );


  if (false) {
    return (
      <>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {builderHeader}

        {error && <div className="alert" style={{ marginBottom: '16px', color: 'var(--danger)', border: '1px solid var(--danger)', padding: '12px', borderRadius: '8px' }}>{error}</div>}

        <div className="card" style={{ marginBottom: '16px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent)' }}>Estimate Workflow</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <button type="button" onClick={() => setBuilderMode('quick')} style={workflowButtonStyle(true)}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Quick Phone Quote</div>
              <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>Default fast quote flow for call-based pane counting and quick totals.</div>
            </button>
            <button type="button" onClick={() => setBuilderMode('detailed')} style={workflowButtonStyle(false)}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Detailed Walkthrough</div>
              <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>Full advanced builder with ToggleCards, adjustments, add-ons, and walkthrough notes.</div>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Phone Call Guide</summary>

            <div style={{ margin: '12px 0 12px' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>
                Service requested
              </label>

              <select
                value={phoneScriptServiceKey}
                onChange={e => setPhoneScriptServiceKey(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--panel-soft)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 8
                }}
              >
                {phoneScriptServiceOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <ul style={{ marginTop: 14, paddingLeft: 20, lineHeight: 1.6 }}>
              {phoneScriptQuestions.map((question, index) => (
                <li key={`${index}-${question}`}>{question}</li>
              ))}
            </ul>
          </details>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Estimate Scope</h3>
            <div className="row" style={{ gap: '12px', marginBottom: '12px' }}>
              <div className="modal-field" style={{ flex: 2 }}>
                <label>Estimate Type</label>
                <select value={estimateType} onChange={handleTypeChange} style={{ padding: '12px', fontSize: '15px', background: 'var(--panel-soft)', color: 'var(--text)' }}>
                  <option value="new">New Customer Estimate</option>
                  <option value="existing">Existing Customer New Estimate</option>
                  <option value="commercial">Commercial Frequency Estimate</option>
                </select>
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Property Type</label>
                <select value={propertyType} onChange={e => setPropertyType(e.target.value)} style={{ padding: '12px', fontSize: '15px', background: 'var(--panel-soft)', color: 'var(--text)' }}>
                  <option value="res">Residential</option>
                  <option value="com">Commercial</option>
                </select>
              </div>
            </div>
            <div className="modal-field">
              <label>Service Level</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setServiceLevel('both')} style={selectionButtonStyle(serviceLevel === 'both')}>Inside & Outside</button>
                <button type="button" onClick={() => setServiceLevel('ext')} style={selectionButtonStyle(serviceLevel === 'ext')}>Exterior Only</button>
              </div>
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Pane Counting Helper</h3>
            <div className="small" style={{ color: 'var(--muted)', marginBottom: 14 }}>Counts mean cleanable panes / pieces of glass, not whole window units.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quickPaneButtons.map(card => {
                const count = Math.max(0, Number(windows[card.key]) || 0);
                return (
                  <div key={card.title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'var(--panel-soft)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px' }}>
                    <div style={{ flex: '1 1 260px' }}>
                      <div style={{ fontWeight: 700 }}>{card.title}</div>
                      <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>{card.helper}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        style={counterButtonStyle}
                        onClick={() => addEstimateWindowCount(setWindows, card.key, -card.delta)}
                        disabled={count <= 0}
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        step={card.delta}
                        value={count}
                        onChange={e => setWindows(prev => ({ ...prev, [card.key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                        style={{ width: 90, padding: '8px', background: 'var(--panel)', color: 'var(--text)' }}
                      />
                      <button
                        type="button"
                        style={counterButtonStyle}
                        onClick={() => addEstimateWindowCount(setWindows, card.key, card.delta)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Common Extras</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {quickPlainExtraOptions.map(counter => (
                <div key={counter.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'var(--panel-soft)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{counter.label}</div>
                    <div className="small" style={{ color: 'var(--muted)' }}>{counter.helper}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setExtras(prev => ({ ...prev, [counter.key]: (Number(prev[counter.key]) || 0) > 0 ? 0 : 1 }))}
                    >
                      {(Number(extras[counter.key]) || 0) > 0 ? 'Remove from Quote' : 'Add to Quote'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Access & Condition</h3>
            {hasDetailedScopeSelections && (
              <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--warn)', background: 'rgba(255, 193, 7, 0.08)' }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--warn)' }}>Detailed-only items are still active in this quote</div>
                <div className="small" style={{ color: 'var(--text)' }}>{detailedScopeSelections.join(', ')}</div>
                <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>Switch to Detailed Walkthrough to edit them, or clear them here to keep this as a phone quote.</div>
                <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={handleClearDetailedSelections}>Clear Detailed Items</button>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--muted)' }}>Quick Add-ons</h4>
              {quickEstimateAddOnControls}
            </div>
            <div className="modal-field" style={{ marginBottom: 16 }}>
              <label>Floors</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { value: 1, label: 'Single-story' },
                  { value: 2, label: 'Two-story' },
                  { value: 3, label: 'Three-story' },
                  { value: 4, label: 'Four-story' },
                ].map(option => (
                  <button key={option.label} type="button" onClick={() => setFloors(option.value)} style={selectionButtonStyle(floors === option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Condition</label>
                <select name="condition" value={form.condition} onChange={handleInputChange} style={{ padding: '10px', width: '100%', background: 'var(--panel-soft)', color: 'var(--text)' }}>
                  {ESTIMATE_CONDITION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </div>
          </section>

          {quickLiveEstimatePanel}
          {quickCustomerDetailsCard}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-danger" onClick={handleClearAll}>Reset Quote</button>
          </div>
        </div>
      </div>
      {builderPriceAnalysisModal}
      </>
    );
  }

  return (
    <>
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      {builderHeader}

      {error && <div className="alert" style={{ marginBottom: '16px', color: 'var(--danger)', border: '1px solid var(--danger)', padding: '12px', borderRadius: '8px' }}>{error}</div>}

      <section className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px' }}>
            {renderSectionHeading(1, 'Estimate Setup', 'Set the pricing context first, then count the scope using the shared stepper layout.')}
          </div>
          <button type="button" className="btn btn-sm btn-danger" onClick={handleClearAll}>Reset Quote</button>
        </div>
        <div className="row" style={{ gap: '12px', marginBottom: '16px' }}>
          <div className="modal-field" style={{ flex: 2 }}>
            <label>Estimate Type</label>
            <select value={estimateType} onChange={handleTypeChange} style={{ padding: '12px', fontSize: '15px', background: 'var(--panel-soft)', color: 'var(--text)' }}>
              <option value="new">New Customer Estimate</option>
              <option value="existing">Existing Customer New Estimate</option>
              <option value="commercial">Commercial Frequency Estimate</option>
            </select>
          </div>
          <div className="modal-field" style={{ flex: 1 }}>
            <label>Property Type <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>(controls pricing rates)</span></label>
            <select value={propertyType} onChange={e => setPropertyType(e.target.value)} style={{ padding: '12px', fontSize: '15px', background: 'var(--panel-soft)', color: 'var(--text)' }}>
              <option value="res">Residential</option>
              <option value="com">Commercial</option>
            </select>
          </div>
        </div>
        <div className="modal-field" style={{ marginBottom: 16 }}>
          <label>Service Level</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setServiceLevel('both')} style={selectionButtonStyle(serviceLevel === 'both')}>Inside & Outside</button>
            <button type="button" onClick={() => setServiceLevel('ext')} style={selectionButtonStyle(serviceLevel === 'ext')}>Exterior Only</button>
          </div>
        </div>
        <div className="modal-field" style={{ marginBottom: 16 }}>
          <label>Building Floors</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {setupFloorOptions.map(option => (
              <button key={option.label} type="button" onClick={() => setFloors(option.value)} style={selectionButtonStyle(floors === option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-field" style={{ marginBottom: 0 }}>
          <label>Condition</label>
          <select name="condition" value={form.condition} onChange={handleInputChange} style={{ padding: '10px', width: '100%', background: 'var(--panel-soft)', color: 'var(--text)' }}>
            {ESTIMATE_CONDITION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </section>

      {(estimateData.total > 0 || manualTotalActive || manualProposalActive) && (
        <div style={{ background: 'var(--panel)', border: '2px solid var(--accent)', borderRadius: 12, padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 14, fontWeight: 600 }}>Running Total</div>
            {manualProposalActive
              ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>Calculator total: {money(estimateData.total)} internal only</div>
              : manualTotalActive && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Calculated: {money(estimateData.total)}</div>}
          </div>
          <div className="small" style={{ color: 'var(--muted)', marginLeft: 'auto' }}>Price Analysis and travel mileage stay synced with this builder.</div>
          <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--good)' }}>{money(finalEstimateTotal)}</span>
        </div>
      )}

      <div className="grid">
        <div className="span-7" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section className="card">
            {renderSectionHeading(2, 'Client Details', 'Name and service address are required before saving or printing a new-customer estimate.')}
            {(estimateType === 'existing' || estimateType === 'commercial') && (
              <div className="modal-field" style={{ marginBottom: '16px' }}>
                <label>Select Customer <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>(fields below auto-fill from selection)</span></label>
                <select value={selectedCustomerId} onChange={handleExistingCustomerSelect} style={{ padding: '12px', width: '100%', background: 'var(--panel-soft)', color: 'var(--text)' }}>
                  <option value="">Search / Select Customer</option>
                  {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name} - {customer.address}</option>)}
                </select>
              </div>
            )}
            <div className="modal-field">
              <label>Name / Company <span style={{ color: 'var(--danger)' }}>*</span>{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
              <input type="text" name="name" value={form.name} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Name / Company" style={{ padding: '10px' }} />
            </div>
            <div className="modal-field">
              <label>Service Address <span style={{ color: 'var(--danger)' }}>*</span>{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
              <input type="text" name="address" value={form.address} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Service Address" style={{ padding: '10px' }} />
            </div>
            <div className="modal-field">
              <label>City, State, ZIP{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
              <input type="text" name="cityStateZip" value={form.cityStateZip} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="City, State, ZIP" style={{ padding: '10px' }} />
            </div>
            <div style={{ marginTop: -2, marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--panel)', border: `1px solid ${builderTravelRouteTone}` }}>
              <div style={{ fontWeight: 700, color: builderTravelRouteTone }}>{builderTravelRouteMessage}</div>
              <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>{builderTravelRouteDetail}</div>
            </div>
            <div className="row" style={{ gap: '12px' }}>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Phone{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
                <input type="text" name="phone" value={form.phone} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Phone" style={{ padding: '10px' }} />
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Email{customerSelectionActive && <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>auto-filled</span>}</label>
                <input type="text" name="email" value={form.email} onChange={handleInputChange} disabled={customerFieldsLocked} placeholder="Email" style={{ padding: '10px' }} />
              </div>
            </div>
          </section>

          <details className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>3. Phone Call Guide</summary>
            <div className="small" style={{ color: 'var(--muted)', marginTop: 12 }}>
              Optional script helper for fast quoting calls. It stays separate from the calculator inputs.
            </div>
            <div style={{ margin: '12px 0 12px' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>Service requested</label>
              <select
                value={phoneScriptServiceKey}
                onChange={e => setPhoneScriptServiceKey(e.target.value)}
                style={{ width: '100%', padding: '10px', background: 'var(--panel-soft)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8 }}
              >
                {phoneScriptServiceOptions.map(option => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>
            <ul style={{ marginTop: 14, paddingLeft: 20, lineHeight: 1.6 }}>
              {phoneScriptQuestions.map((question, index) => (
                <li key={`${index}-${question}`}>{question}</li>
              ))}
            </ul>
          </details>

          <section className="card">
            {renderSectionHeading(4, 'Window Counts', 'Pane counts mean cleanable pieces of glass, not whole window units.')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quickPaneButtons.map(card => renderStepperRow({
                rowKey: card.key,
                title: card.title,
                helper: card.helper,
                value: windows[card.key],
                step: card.delta,
                onDecrease: () => addEstimateWindowCount(setWindows, card.key, -card.delta),
                onIncrease: () => addEstimateWindowCount(setWindows, card.key, card.delta),
                onChange: next => setWindows(prev => ({ ...prev, [card.key]: next })),
              }))}
            </div>
          </section>

          <section className="card">
            {renderSectionHeading(5, 'Core Extras', 'Use the same stepper layout for screen and track counts so the quote stays fast and scannable.')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {coreExtraRowConfigs.map(config => renderStepperRow({
                rowKey: config.key,
                title: config.title,
                helper: config.helper,
                value: extras[config.key],
                onDecrease: () => updateExtraCount(config.key, -1),
                onIncrease: () => updateExtraCount(config.key, 1),
                onChange: next => setExtras(prev => ({ ...prev, [config.key]: next })),
              }))}
            </div>
          </section>

          <section className="card">
            {renderSectionHeading(6, 'Add-on Services', 'Advanced services stay visible on the same page and feed the same live estimate total.')}
            {estimateAddOnControls}
          </section>

          <section className="card">
            {renderSectionHeading(7, 'Adjustments', 'Use these for restoration work, access issues, or custom service text that should appear in the estimate message.')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {adjustmentRowConfigs.map(config => renderStepperRow({
                rowKey: config.key,
                title: config.title,
                helper: config.helper,
                value: extras[config.key],
                onDecrease: () => updateExtraCount(config.key, -1),
                onIncrease: () => updateExtraCount(config.key, 1),
                onChange: next => setExtras(prev => ({ ...prev, [config.key]: next })),
              }))}
            </div>
            <div className="row" style={{ marginTop: '20px', gap: '12px' }}>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Job Notes / Access Notes</label>
                <textarea name="notes" value={form.notes} onChange={handleInputChange} rows="2" style={{ padding: '10px' }} placeholder="Access issues, callback notes, codes, staging, or similar details." />
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label>Other Services (Custom text)</label>
                <textarea name="otherText" value={form.otherText} onChange={handleInputChange} rows="2" style={{ padding: '10px' }} placeholder="Chandeliers, mirrors, custom scope text, or other customer-facing services." />
              </div>
            </div>
          </section>
        </div>

        <div className="span-5">
          <div style={{ position: 'sticky', top: '20px' }}>
            {liveEstimatePanel}
          </div>
        </div>
      </div>
    </div>
    {builderPriceAnalysisModal}
    </>
  );
}

// â”€â”€â”€ PRICE ANALYSIS WORKSPACE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PriceAnalysisWorkspace({
  customers,
  serviceJobs,
  estimateBuilderSnapshot,
  mode = 'page',
  initialRevenueSource = null,
  showPageHeader = true,
}) {
  estimateBuilderSnapshot = estimateBuilderSnapshot || DEFAULT_ESTIMATE_BUILDER_SNAPSHOT;
  const isModal = mode === 'modal';
  const customerById = useMemo(() => {
    const lookup = new Map();
    (customers || []).forEach(customer => lookup.set(String(customer.id), customer));
    return lookup;
  }, [customers]);

  const savedEstimateOptions = useMemo(() => {
    return [...(serviceJobs || [])]
      .filter(job => {
        const revenue = Math.max(0, Number(job?.quotedAmount) || Number(job?.actualAmount) || 0);
        return revenue > 0;
      })
      .sort((a, b) => {
        const jobDelta = (Number(b?.jobNumber) || 0) - (Number(a?.jobNumber) || 0);
        if (jobDelta !== 0) return jobDelta;
        return String(b?.id || '').localeCompare(String(a?.id || ''));
      })
      .map(job => {
        const revenue = Math.max(0, Number(job?.quotedAmount) || Number(job?.actualAmount) || 0);
        const customer = customerById.get(String(job?.customerId));
        const titleBits = [
          job?.jobNumber ? `#${job.jobNumber}` : `Job ${String(job?.id || '').slice(0, 6)}`,
          customer?.name || 'Customer',
          job?.serviceType || job?.status || 'Estimate',
        ].filter(Boolean);
        return {
          id: String(job.id),
          label: `${titleBits.join(' | ')} | ${money(revenue)}`,
          revenue,
        };
      });
  }, [customerById, serviceJobs]);

  const [revenueSource, setRevenueSource] = useState(() => {
    if (initialRevenueSource === 'builder' && estimateBuilderSnapshot?.hasRevenue) return 'builder';
    if (initialRevenueSource === 'saved' && savedEstimateOptions.length > 0) return 'saved';
    if (initialRevenueSource === 'manual') return 'manual';
    return estimateBuilderSnapshot?.hasRevenue ? 'builder' : (savedEstimateOptions.length ? 'saved' : 'manual');
  });
  const [selectedEstimateId, setSelectedEstimateId] = useState(() => (
    savedEstimateOptions[0] ? String(savedEstimateOptions[0].id) : ''
  ));
  const [manualRevenue, setManualRevenue] = useState('');
  const [roundTripMiles, setRoundTripMiles] = useState(0);
  const [roundTripMilesTouched, setRoundTripMilesTouched] = useState(false);
  const [otherJobCosts, setOtherJobCosts] = useState(0);
  const [costSettings, setCostSettings] = useState(() => loadProfitAnalysisDefaults());

  useEffect(() => {
    try {
      localStorage.setItem(PROFIT_ANALYSIS_SETTINGS_KEY, JSON.stringify(costSettings));
    } catch { }
  }, [costSettings]);

  useEffect(() => {
    if (revenueSource === 'builder' && !estimateBuilderSnapshot?.hasRevenue) {
      setRevenueSource(savedEstimateOptions.length ? 'saved' : 'manual');
      return;
    }
    if (revenueSource === 'saved' && !savedEstimateOptions.length) {
      setRevenueSource(estimateBuilderSnapshot?.hasRevenue ? 'builder' : 'manual');
    }
  }, [estimateBuilderSnapshot?.hasRevenue, revenueSource, savedEstimateOptions.length]);

  useEffect(() => {
    if (!savedEstimateOptions.length) {
      if (selectedEstimateId) setSelectedEstimateId('');
      return;
    }
    if (!savedEstimateOptions.some(option => option.id === selectedEstimateId)) {
      setSelectedEstimateId(savedEstimateOptions[0].id);
    }
  }, [savedEstimateOptions, selectedEstimateId]);

  const selectedEstimate = useMemo(
    () => savedEstimateOptions.find(option => option.id === selectedEstimateId) || null,
    [savedEstimateOptions, selectedEstimateId]
  );
  const builderTravelRoundTripMiles = Math.max(0, estimatePricingNumber(estimateBuilderSnapshot?.travelRoundTripMiles, 0));
  const builderTravelRouteStatus = String(estimateBuilderSnapshot?.travelRouteStatus || 'idle');
  const builderTravelRouteError = String(estimateBuilderSnapshot?.travelRouteError || '').trim();

  useEffect(() => {
    if (revenueSource !== 'builder' || roundTripMilesTouched) return;
    if (builderTravelRouteStatus === 'ready') {
      setRoundTripMiles(prev => Math.abs(prev - builderTravelRoundTripMiles) > 0.009 ? builderTravelRoundTripMiles : prev);
      return;
    }
    setRoundTripMiles(prev => (prev === 0 ? prev : 0));
  }, [builderTravelRoundTripMiles, builderTravelRouteStatus, revenueSource, roundTripMilesTouched]);

  const revenue = useMemo(() => {
    if (revenueSource === 'builder') return Math.max(0, estimatePricingNumber(estimateBuilderSnapshot?.revenue, 0));
    if (revenueSource === 'saved') return Math.max(0, estimatePricingNumber(selectedEstimate?.revenue, 0));
    return Math.max(0, estimatePricingNumber(manualRevenue, 0));
  }, [estimateBuilderSnapshot?.revenue, manualRevenue, revenueSource, selectedEstimate]);

  const roundTripMilesValue = Math.max(0, estimatePricingNumber(roundTripMiles, 0));
  const otherJobCostsValue = Math.max(0, estimatePricingNumber(otherJobCosts, 0));
  const vehicleMpgValue = Math.max(0, estimatePricingNumber(costSettings.vehicleMpg, 0));
  const gasPriceValue = Math.max(0, estimatePricingNumber(costSettings.gasPrice, 0));
  const maintenanceCostPerMileValue = Math.max(0, estimatePricingNumber(costSettings.maintenanceCostPerMile, 0));
  const suppliesCostValue = Math.max(0, estimatePricingNumber(costSettings.suppliesCost, 0));
  const equipmentDepreciationValue = Math.max(0, estimatePricingNumber(costSettings.equipmentDepreciation, 0));
  const fixedCostAllocationValue = Math.max(0, estimatePricingNumber(costSettings.fixedCostAllocationOverride, 0));

  const metrics = useMemo(() => {
    const fuelCost = vehicleMpgValue > 0 ? (roundTripMilesValue / vehicleMpgValue) * gasPriceValue : 0;
    const vehicleMaintenance = roundTripMilesValue * maintenanceCostPerMileValue;
    const protectedLaborPay = revenue * (PROFIT_ANALYSIS_TARGET_LABOR_PERCENT / 100);
    const officeReserve = revenue * (PROFIT_ANALYSIS_TARGET_OFFICE_PERCENT / 100);
    const targetExpenseReserve = revenue * (PROFIT_ANALYSIS_TARGET_EXPENSE_PERCENT / 100);
    const requiredExpenses = fuelCost
      + vehicleMaintenance
      + suppliesCostValue
      + equipmentDepreciationValue
      + fixedCostAllocationValue
      + otherJobCostsValue;
    const expenseOverage = Math.max(0, requiredExpenses - targetExpenseReserve);
    const allocationSurplusShortfall = revenue - protectedLaborPay - requiredExpenses;
    const breakEvenPrice = protectedLaborPay + requiredExpenses;
    const recommendedAdjustedPrice = (protectedLaborPay + requiredExpenses) / 0.90;
    const suggestedQuotePrice = recommendedAdjustedPrice > 0 ? Math.ceil(recommendedAdjustedPrice / 5) * 5 : 0;
    const suggestedIncrease = Math.max(0, suggestedQuotePrice - revenue);
    const officeReserveAtAdjustedPrice = recommendedAdjustedPrice * 0.10;
    const trueLaborPercent = revenue > 0 ? (protectedLaborPay / revenue) * 100 : 0;
    const trueExpensePercent = revenue > 0 ? (requiredExpenses / revenue) * 100 : 0;
    const trueOfficePercent = revenue > 0 ? (officeReserve / revenue) * 100 : 0;
    const projectedLaborPercent = suggestedQuotePrice > 0 ? (protectedLaborPay / suggestedQuotePrice) * 100 : 0;
    const projectedOfficePercent = suggestedQuotePrice > 0 ? ((suggestedQuotePrice * 0.10) / suggestedQuotePrice) * 100 : 0;
    const projectedExpensePercent = suggestedQuotePrice > 0 ? (requiredExpenses / suggestedQuotePrice) * 100 : 0;
    return {
      fuelCost,
      vehicleMaintenance,
      protectedLaborPay,
      officeReserve,
      targetExpenseReserve,
      requiredExpenses,
      expenseOverage,
      allocationSurplusShortfall,
      breakEvenPrice,
      recommendedAdjustedPrice,
      suggestedQuotePrice,
      suggestedIncrease,
      officeReserveAtAdjustedPrice,
      trueLaborPercent,
      trueExpensePercent,
      trueOfficePercent,
      projectedLaborPercent,
      projectedOfficePercent,
      projectedExpensePercent,
    };
  }, [equipmentDepreciationValue, fixedCostAllocationValue, gasPriceValue, maintenanceCostPerMileValue, otherJobCostsValue, revenue, roundTripMilesValue, suppliesCostValue, vehicleMpgValue]);

  const tone = useMemo(() => {
    if (metrics.allocationSurplusShortfall < 0) {
      return {
        key: 'red',
        label: 'Underpriced',
        color: 'var(--danger)',
        border: 'rgba(255, 107, 107, 0.4)',
        background: 'rgba(255, 107, 107, 0.10)',
        recommendation: 'This job is underpriced. Increase the price to maintain protected labor pay and cover required expenses.',
      };
    }
    if (metrics.requiredExpenses > metrics.targetExpenseReserve) {
      return {
        key: 'yellow',
        label: 'Price Increase Needed',
        color: 'var(--warn)',
        border: 'rgba(255, 179, 71, 0.4)',
        background: 'rgba(255, 179, 71, 0.12)',
        recommendation: 'Expenses exceed the 10% target. Labor payout is protected. Recommended price increase covers actual expenses while preserving a 10% office reserve.',
      };
    }
    return {
      key: 'green',
      label: 'On Target',
      color: 'var(--good)',
      border: 'rgba(64, 192, 87, 0.4)',
      background: 'rgba(64, 192, 87, 0.10)',
      recommendation: 'This job supports the target allocation.',
    };
  }, [metrics.allocationSurplusShortfall, metrics.requiredExpenses, metrics.targetExpenseReserve]);

  const outputCards = [
    { label: 'Revenue', value: formatCurrency(revenue), helper: revenueSource === 'manual' ? 'Manual revenue input' : revenueSource === 'saved' ? 'From selected saved estimate/job' : 'From current Estimate Builder total' },
    { label: 'Protected Labor Pay', value: formatCurrency(metrics.protectedLaborPay), helper: `${PROFIT_ANALYSIS_TARGET_LABOR_PERCENT}% labor / owner pay stays protected` },
    { label: 'Office Reserve', value: formatCurrency(metrics.officeReserve), helper: `${PROFIT_ANALYSIS_TARGET_OFFICE_PERCENT}% office / admin target at the current revenue` },
    { label: 'Required Expenses', value: formatCurrency(metrics.requiredExpenses), helper: 'Fuel, maintenance, supplies, equipment, fixed allocation, and other job costs' },
    { label: 'True Expense %', value: `${metrics.trueExpensePercent.toFixed(1)}%`, helper: 'Required expenses as a share of current revenue' },
    { label: 'Allocation Surplus / Shortfall', value: formatCurrency(metrics.allocationSurplusShortfall), helper: 'What remains after protected labor pay and required expenses' },
    { label: 'Recommended Adjusted Price', value: formatCurrency(metrics.recommendedAdjustedPrice), helper: 'Exact modeled price before quote rounding' },
    { label: 'Suggested Increase', value: formatCurrency(metrics.suggestedIncrease), helper: 'Additional price needed above the current revenue' },
    { label: 'Projected Expense %', value: `${metrics.projectedExpensePercent.toFixed(1)}%`, helper: 'Expense share at the rounded suggested quote price' },
    { label: 'Office Reserve at Adjusted Price', value: formatCurrency(metrics.officeReserveAtAdjustedPrice), helper: '10% office reserve created by the recommended adjusted price' },
    { label: 'Expense Overage', value: formatCurrency(metrics.expenseOverage), helper: 'Amount above the 10% target expense reserve' },
    { label: 'True Labor %', value: `${metrics.trueLaborPercent.toFixed(1)}%`, helper: 'Protected labor pay as a share of current revenue' },
    { label: 'True Office %', value: `${metrics.trueOfficePercent.toFixed(1)}%`, helper: 'Office reserve as a share of revenue' },
    { label: 'Projected Labor %', value: `${metrics.projectedLaborPercent.toFixed(1)}%`, helper: 'Protected labor pay as a share of the rounded suggested quote price' },
    { label: 'Projected Office %', value: `${metrics.projectedOfficePercent.toFixed(1)}%`, helper: 'Office reserve share at the rounded suggested quote price' },
  ];

  const breakdownCards = [
    { label: 'Fuel Cost', value: formatCurrency(metrics.fuelCost) },
    { label: 'Vehicle Maintenance', value: formatCurrency(metrics.vehicleMaintenance) },
    { label: 'Supplies / Chemicals', value: formatCurrency(suppliesCostValue) },
    { label: 'Equipment Depreciation', value: formatCurrency(equipmentDepreciationValue) },
    { label: 'Fixed Cost Allocation', value: formatCurrency(fixedCostAllocationValue) },
    { label: 'Other Job Costs', value: formatCurrency(otherJobCostsValue) },
    { label: 'Target Expense Reserve', value: formatCurrency(metrics.targetExpenseReserve) },
    { label: 'Break-even Price', value: formatCurrency(metrics.breakEvenPrice) },
    { label: 'Suggested Quote Price', value: formatCurrency(metrics.suggestedQuotePrice) },
  ];

  const updateCostSetting = (field, rawValue) => {
    setCostSettings(prev => ({
      ...prev,
      [field]: Math.max(0, estimatePricingNumber(rawValue, 0)),
    }));
  };

  const sourceSummary = revenueSource === 'builder'
    ? (estimateBuilderSnapshot?.hasRevenue
      ? `${estimateBuilderSnapshot.label || 'Estimate Builder'}${estimateBuilderSnapshot.manualOverrideActive ? ' | manual override active' : ''}`
      : 'No active estimate builder total available.')
    : revenueSource === 'saved'
      ? (selectedEstimate?.label || 'Choose a saved estimate or job to import revenue.')
      : 'Enter revenue manually when quoting outside the estimate builder.';
  const mileageSummary = revenueSource === 'builder'
    ? (
      builderTravelRouteStatus === 'ready'
        ? `Auto-filled from ${estimateBuilderSnapshot?.travelRouteLabel || 'the saved road route'}${estimateBuilderSnapshot?.routeAddress ? ` to ${estimateBuilderSnapshot.routeAddress}` : ''}. You can still override it.`
        : builderTravelRouteStatus === 'loading' || builderTravelRouteStatus === 'waiting'
          ? 'Calculating road mileage from the saved routing defaults...'
          : builderTravelRouteStatus === 'error'
            ? (builderTravelRouteError || 'Travel miles unavailable. Enter mileage manually.')
            : 'Enter a service address in Estimate Builder to auto-fill round trip miles here.'
    )
    : 'Mileage stays editable when you analyze saved jobs or manual revenue.';

  const metricCardStyle = {
    background: 'var(--panel-soft)',
    border: `1px solid ${tone.border}`,
    borderRadius: 14,
    padding: 14,
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.12)',
  };
  const containerStyle = isModal ? { width: '100%' } : { maxWidth: 1180, margin: '0 auto' };

  return (
    <div style={containerStyle}>
      {showPageHeader && (
        <div className="title-row" style={{ marginBottom: 24 }}>
          <div>
            <div className="pill">Unit Economics</div>
            <h2>Profit Analysis</h2>
            <div className="sub">Use the 80 / 10 / 10 reserve model to see whether revenue truly covers office, expenses, and labor pay.</div>
          </div>
        </div>
      )}

      <div className="grid">
        <div className="span-7" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>Revenue Source</h3>
                <div className="sub" style={{ marginTop: 4 }}>Use the current builder total, select a saved estimate, or type revenue manually.</div>
              </div>
              <span
                className="badge"
                style={{
                  color: tone.color,
                  borderColor: tone.border,
                  background: tone.background,
                  fontWeight: 700,
                }}
              >
                {tone.label}
              </span>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="modal-field">
                <label htmlFor="profit-revenue-source">Revenue Source</label>
                <select
                  id="profit-revenue-source"
                  value={revenueSource}
                  onChange={e => setRevenueSource(e.target.value)}
                  style={{ background: 'var(--panel-soft)', color: 'var(--text)' }}
                >
                  {estimateBuilderSnapshot?.hasRevenue && <option value="builder">Current Estimate Builder</option>}
                  {savedEstimateOptions.length > 0 && <option value="saved">Saved Estimate / Job</option>}
                  <option value="manual">Manual Revenue Entry</option>
                </select>
              </div>

              {revenueSource === 'saved' && (
                <div className="modal-field">
                  <label htmlFor="profit-estimate-select">Saved Estimate / Job</label>
                  <select
                    id="profit-estimate-select"
                    value={selectedEstimateId}
                    onChange={e => setSelectedEstimateId(e.target.value)}
                    style={{ background: 'var(--panel-soft)', color: 'var(--text)' }}
                  >
                    {savedEstimateOptions.map(option => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="modal-field">
                <label htmlFor="profit-revenue">Revenue / Estimate Total</label>
                <input
                  id="profit-revenue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={revenueSource === 'manual' ? manualRevenue : revenue.toFixed(2)}
                  onChange={e => setManualRevenue(e.target.value)}
                  readOnly={revenueSource !== 'manual'}
                  aria-describedby="profit-revenue-help"
                  style={{ background: revenueSource === 'manual' ? 'var(--panel-soft)' : 'var(--panel)', color: 'var(--text)' }}
                />
                <div id="profit-revenue-help" className="small" style={{ marginTop: 6 }}>{sourceSummary}</div>
              </div>

              <div className="note" style={{ marginTop: 22, borderColor: tone.border, background: tone.background }}>
                <div className="small" style={{ color: 'var(--muted)', marginBottom: 6 }}>
                  Target allocation: {PROFIT_ANALYSIS_TARGET_LABOR_PERCENT}% labor / owner pay, {PROFIT_ANALYSIS_TARGET_OFFICE_PERCENT}% office / admin, {PROFIT_ANALYSIS_TARGET_EXPENSE_PERCENT}% expense reserve.
                </div>
                <div className="small" style={{ color: tone.color, fontWeight: 700, marginBottom: 4 }}>Recommendation</div>
                <div style={{ color: 'var(--text)' }}>{tone.recommendation}</div>
              </div>
            </div>
          </section>

          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>Job Inputs</h3>
                <div className="sub" style={{ marginTop: 4 }}>Enter mileage and job costs so the calculator can tell you when the job price must increase to protect labor.</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setCostSettings(loadProfitAnalysisDefaults())}>Reset Saved Defaults</button>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="modal-field">
                <label htmlFor="profit-miles">Round trip miles</label>
                <input
                  id="profit-miles"
                  type="number"
                  min="0"
                  step="0.1"
                  value={roundTripMiles}
                  onChange={e => {
                    setRoundTripMilesTouched(true);
                    setRoundTripMiles(Math.max(0, estimatePricingNumber(e.target.value, 0)));
                  }}
                />
                <div className="small" style={{ marginTop: 6, color: revenueSource === 'builder' && builderTravelRouteStatus === 'error' ? 'var(--warn)' : 'var(--muted)' }}>
                  {mileageSummary}
                </div>
              </div>
              <div className="modal-field">
                <label htmlFor="profit-other-job-costs">Other job costs</label>
                <input id="profit-other-job-costs" type="number" min="0" step="0.01" value={otherJobCosts} onChange={e => setOtherJobCosts(Math.max(0, estimatePricingNumber(e.target.value, 0)))} />
              </div>
            </div>

            <div className="row4" style={{ gap: 12 }}>
              <div className="modal-field">
                <label htmlFor="profit-vehicle-mpg">Vehicle MPG</label>
                <input id="profit-vehicle-mpg" type="number" min="0" step="0.1" value={costSettings.vehicleMpg} onChange={e => updateCostSetting('vehicleMpg', e.target.value)} />
              </div>
              <div className="modal-field">
                <label htmlFor="profit-gas-price">Gas price per gallon</label>
                <input id="profit-gas-price" type="number" min="0" step="0.01" value={costSettings.gasPrice} onChange={e => updateCostSetting('gasPrice', e.target.value)} />
              </div>
            </div>

            <div className="row4" style={{ gap: 12 }}>
              <div className="modal-field">
                <label htmlFor="profit-maintenance">Vehicle maintenance cost per mile</label>
                <input id="profit-maintenance" type="number" min="0" step="0.01" value={costSettings.maintenanceCostPerMile} onChange={e => updateCostSetting('maintenanceCostPerMile', e.target.value)} />
              </div>
              <div className="modal-field">
                <label htmlFor="profit-supplies">Supplies / chemicals cost</label>
                <input id="profit-supplies" type="number" min="0" step="0.01" value={costSettings.suppliesCost} onChange={e => updateCostSetting('suppliesCost', e.target.value)} />
              </div>
              <div className="modal-field">
                <label htmlFor="profit-equipment">Equipment depreciation per job</label>
                <input id="profit-equipment" type="number" min="0" step="0.01" value={costSettings.equipmentDepreciation} onChange={e => updateCostSetting('equipmentDepreciation', e.target.value)} />
              </div>
              <div className="modal-field">
                <label htmlFor="profit-fixed-cost">Fixed cost allocation override</label>
                <input id="profit-fixed-cost" type="number" min="0" step="0.01" value={costSettings.fixedCostAllocationOverride} onChange={e => updateCostSetting('fixedCostAllocationOverride', e.target.value)} />
              </div>
            </div>

            <div className="small" style={{ marginTop: 10 }}>
              Mileage and reserve assumptions save locally in this CRM browser. Other job costs stay job-specific so you can change them per quote.
            </div>
          </section>
        </div>

        <div className="span-5" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ border: `1px solid ${tone.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>Profitability Snapshot</h3>
                <div className="sub" style={{ marginTop: 4 }}>All values below update live from the inputs on this tab.</div>
              </div>
              <div className="small" style={{ color: tone.color, fontWeight: 700 }}>
                Allocation status: {tone.label}
              </div>
            </div>

            <div className="row4" style={{ gap: 12 }}>
              {outputCards.map(card => (
                <div key={card.label} style={metricCardStyle}>
                  <div className="small" style={{ marginBottom: 6 }}>{card.label}</div>
                  <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: card.label === 'Allocation Surplus / Shortfall' || card.label === 'Expense Overage' || card.label === 'Suggested Increase' ? tone.color : 'var(--text)' }}>
                    {card.value}
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>{card.helper}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Expense Breakdown</h3>
            <div className="row" style={{ gap: 12 }}>
              {breakdownCards.map(card => (
                <div key={card.label} className="note" style={{ marginTop: 0 }}>
                  <div className="small">{card.label}</div>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{card.value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ PROFIT ANALYSIS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ProfitAnalysisTab({ customers, serviceJobs, estimateBuilderSnapshot }) {
  return (
    <PriceAnalysisWorkspace
      customers={customers}
      serviceJobs={serviceJobs}
      estimateBuilderSnapshot={estimateBuilderSnapshot}
      mode="page"
      showPageHeader={true}
    />
  );
}

// â”€â”€â”€ RECEIPT GENERATOR TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ReceiptTab({ customers, serviceJobs }) {
  function todayStr() {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
  }

  const [selectedJobId, setSelectedJobId] = useState('');
  const [form, setForm] = useState({
    receiptNum: '', date: '', customerName: '', serviceAddress: '',
    cityStateZip: '', phone: '', email: '', notes: '', locationList: '',
    cost: '$0.00', receivedBy: '', otherServiceText: '', continueOnAttachment: false
  });
  const [services, setServices] = useState({
    interiorExterior: false, exterior: false, interior: false,
    pressureWashing: false, screenCleaning: false, hardWater: false,
    construction: false, gutter: false, other: false
  });

  function loadJob(jobId) {
    setSelectedJobId(jobId);
    if (!jobId) return;
    const job = serviceJobs.find(j => j.id === jobId);
    if (!job) return;
    const cust = customers.find(c => String(c.id) === String(job.customerId));
    const receiptSelection = getReceiptServiceSelectionFromJob(job);
    setServices(receiptSelection.serviceFlags);
    const dateStr = job.scheduledDate
      ? (() => { const p = job.scheduledDate.split('-'); return p.length === 3 ? `${p[1]}-${p[2]}-${p[0]}` : job.scheduledDate; })()
      : todayStr();
    setForm(prev => ({
      ...prev,
      receiptNum: buildReceiptNumber(cust),
      date: dateStr,
      customerName: cust?.name || '',
      serviceAddress: job.address || cust?.address || '',
      cityStateZip: cust?.cityStateZip || '',
      phone: cust?.phone || '',
      email: cust?.email || '',
      cost: `$${getJobReceiptAmount(job).toFixed(2)}`,
      notes: getReceiptNotesFromJob(job),
      locationList: '',
      receivedBy: '',
      otherServiceText: receiptSelection.otherServiceText,
      continueOnAttachment: false
    }));
  }

  const handleInput = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const handleService = e => setServices(prev => ({ ...prev, [e.target.name]: e.target.checked }));
  const selectedReceiptServices = useMemo(() => getSelectedReceiptServices(services), [services]);
  const receiptTextMeasurer = useMemo(() => createReceiptTextMeasurer({ fontSize: 9, fontFamily: 'Helvetica' }), []);
  const receiptLayout = useMemo(() => measureReceiptLayout({
    notes: form.notes,
    locationList: form.locationList,
    selectedServices: selectedReceiptServices,
    otherServiceText: form.otherServiceText,
    continueOnAttachment: form.continueOnAttachment,
    measureText: receiptTextMeasurer,
  }), [form.notes, form.locationList, form.otherServiceText, form.continueOnAttachment, selectedReceiptServices, receiptTextMeasurer]);
  const receiptLayoutLabel = receiptLayout.rawStatus === 'fit'
    ? 'Fits on one receipt'
    : receiptLayout.rawStatus === 'warning'
      ? 'Close to bottom margin'
      : 'Will overflow past receipt footer';
  const receiptLayoutTone = receiptLayout.rawStatus === 'fit'
    ? { border: 'var(--good)', background: 'rgba(60, 179, 113, 0.08)', color: 'var(--good)' }
    : receiptLayout.rawStatus === 'warning'
      ? { border: 'var(--warn)', background: 'rgba(255, 193, 7, 0.10)', color: 'var(--warn)' }
      : { border: 'var(--danger)', background: 'rgba(220, 53, 69, 0.10)', color: 'var(--danger)' };

  function escapeCsv(v) {
    const s = String(v == null ? '' : v);
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function padRow(r, w = 9) { const o = [...r]; while (o.length < w) o.push(''); return o; }

  function buildGrid(copyType) {
    const c = k => services[k] ? 'x' : '';

    // Each newline in notes becomes its own CSV row on the left side
    const noteLines = (form.notes || '').split('\n');
    const locationLines = form.locationList ? form.locationList.split('\n') : [];

    // Each newline in other service text becomes a continuation row on the right side
    const rawOther = (form.otherServiceText || '').split('\n');
    const otherSvcRows = rawOther.map((l, i) => [
      i === 0 ? c('other') : '',
      i === 0 ? (l ? `Other: ${l}` : 'Other:') : `  ${l}`
    ]);

    // Left side: 7 fixed info rows + "Service Notes:" label + one row per note line
    const leftRows = [
      ['Receipt #:', form.receiptNum],
      ['Date of Service:', form.date],
      ['Customer Name:', form.customerName],
      ['Service Address:', form.serviceAddress],
      ['City, State, ZIP:', form.cityStateZip],
      ['Phone:', form.phone],
      ['Email:', form.email],
      ['Service Notes:', ''],
      ...noteLines.map(l => [l, '']),
      ...(locationLines.length > 0 ? [['Locations / Units:', ''], ...locationLines.map(l => [l, ''])] : []),
      ...(form.continueOnAttachment && receiptLayout.usesAttachment ? [['PDF Attachment:', 'Included in PDF export']] : []),
    ];

    // Right side: 8 fixed service checkboxes + otherSvcRows (one per other-text line)
    const svcRows = [
      [c('interiorExterior'), 'Interior/Exterior Cleaning'],
      [c('exterior'), 'Exterior Cleaning'],
      [c('interior'), 'Interior Cleaning'],
      [c('pressureWashing'), 'Pressure Washing/Soft Washing'],
      [c('screenCleaning'), 'Screen Cleaning'],
      [c('hardWater'), 'Hard Water Removal'],
      [c('construction'), 'Construction/Paint Removal'],
      [c('gutter'), 'Gutter Cleaning'],
      ...otherSvcRows,
    ];

    // Merge left and right into 9-column rows; shorter side gets empty cells
    const maxRows = Math.max(leftRows.length, svcRows.length);
    const merged = [];
    for (let i = 0; i < maxRows; i++) {
      const L = leftRows[i] || ['', ''];
      const R = svcRows[i] || ['', ''];
      merged.push([L[0], L[1], '', '', '', R[0], '', R[1]]);
    }

    return [
      ['FieldOps Demo ', '', '', '', '', '', '', '', ''],
      ['Professional, Affordable Window Cleaning ', '', '', '', '', '', '', '', ''],
      [`Phone: ${BUSINESS.phone}`, `Email: ${BUSINESS.email}`, '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['SERVICE RECEIPT', '', 'DESCRIPTION OF SERVICE PROVIDED:', '', '', '', '', '', ''],
      ...merged,
      ['', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['Total Cost of Services:', form.cost, 'Received By:', form.receivedBy, '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['Thank you for choosing FieldOps Demo. ', '', '', '', '', '', '', '', `[${copyType}]`],
      ['We truly appreciate your business!', '', '', '', '', '', '', '', ''],
    ];
  }

  function safeFileName() {
    const name = (form.customerName || 'Customer').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'Customer';
    const year = form.date.split('-')[2] || new Date().getFullYear();
    return `Invoice ${name} ${year}`;
  }

  function getReceiptTheme() {
    const rootStyles = typeof window !== 'undefined'
      ? window.getComputedStyle(document.documentElement)
      : null;
    const readVar = (name, fallback) => rootStyles?.getPropertyValue(name).trim() || fallback;

    return {
      paper: '#ffffff',
      panel: readVar('--panel', '#121933'),
      panelSoft: readVar('--panel-soft', '#0d1430'),
      text: readVar('--text', '#e8ecf8'),
      muted: readVar('--muted', '#aab4d4'),
      accent: readVar('--accent', '#6ea8fe'),
      border: readVar('--border', '#2a3668'),
      ink: '#0d1224',
      inkMuted: '#5a6890',
      accentInk: '#2a5bbf',
      line: '#c5cfe8',
      sectionTint: '#f5f8ff',
    };
  }

  function downloadCSV(e) {
    e.preventDefault();
    const gap = [['', '', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '', '']];
    const all = [...buildGrid('CUSTOMER COPY'), ...gap, ...buildGrid('MERCHANT COPY')];
    const csv = all.map(r => r.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${safeFileName()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadPDF() {
    const total = Number(String(form.cost || '').replace(/[^0-9.-]+/g, '')) || 0;
    await generateReceiptPDF({
      id: form.receiptNum || 'Receipt',
      date: form.date || '',
      customerName: form.customerName || '',
      address: form.serviceAddress || '',
      cityStateZip: form.cityStateZip || '',
      phone: form.phone || '',
      email: form.email || '',
      notes: form.notes || '',
      locationList: form.locationList || '',
      total,
      receivedBy: form.receivedBy || '',
      services: selectedReceiptServices,
      otherServiceText: form.otherServiceText || '',
      continueOnAttachment: Boolean(form.continueOnAttachment),
    });
  }

  const previewGrid = useMemo(() => {
    const gap = [['', '', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '', '']];
    return [...buildGrid('CUSTOMER COPY'), ...gap, ...buildGrid('MERCHANT COPY')];
  }, [form, services]);

  const sortedJobs = useMemo(() =>
    [...serviceJobs].sort((a, b) => (b.jobNumber || 0) - (a.jobNumber || 0)),
    [serviceJobs]
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 20px' }}>
        <div>
          <h2 style={{ color: 'var(--accent)', margin: 0 }}>Receipt Generator</h2>
          <p className="sub" style={{ margin: '4px 0 0' }}>Generate a formatted two-copy receipt CSV. Select a job to auto-fill, or fill manually.</p>
        </div>
        <img src="/static/demo-logo.svg" alt="FieldOps Demo" style={{ height: 56, width: 'auto', objectFit: 'contain', borderRadius: 8, background: '#fff', padding: 4 }} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <label>Auto-fill from existing job</label>
        <select value={selectedJobId} onChange={e => loadJob(e.target.value)}>
          <option value="">â€” Select a job to auto-fill â€”</option>
          {sortedJobs.map(j => {
            const cust = customers.find(c => String(c.id) === String(j.customerId));
            return (
              <option key={j.id} value={j.id}>
                #{j.jobNumber} â€” {cust?.name || 'Unknown'} â€” {j.serviceType} â€” ${(j.actualAmount || 0).toFixed(2)} ({j.status})
              </option>
            );
          })}
        </select>
      </div>

      <form onSubmit={downloadCSV}>
        <div className="row" style={{ gap: 20, alignItems: 'start' }}>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: 4 }}>Receipt Details</div>
            <div className="row">
              <div><label>Receipt #</label><input type="text" name="receiptNum" value={form.receiptNum} onChange={handleInput} required /></div>
              <div><label>Date (MM-DD-YYYY)</label><input type="text" name="date" value={form.date} onChange={handleInput} required /></div>
            </div>
            <div><label>Customer Name</label><input type="text" name="customerName" value={form.customerName} onChange={handleInput} required /></div>
            <div><label>Service Address</label><input type="text" name="serviceAddress" value={form.serviceAddress} onChange={handleInput} /></div>
            <div><label>City, State, ZIP</label><input type="text" name="cityStateZip" value={form.cityStateZip} onChange={handleInput} /></div>
            <div className="row">
              <div><label>Phone</label><input type="text" name="phone" value={form.phone} onChange={handleInput} /></div>
              <div><label>Email</label><input type="text" name="email" value={form.email} onChange={handleInput} /></div>
            </div>
            <div>
              <label>Service Notes</label>
              <textarea name="notes" value={form.notes} onChange={handleInput} onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} rows={2} placeholder={"e.g. 10% OFF New Customer\n2 story home\nHard water on south windows"} style={{ minHeight: 60, resize: 'none', overflow: 'hidden' }} />
              <div className="note" style={{ marginTop: 10, borderColor: receiptLayoutTone.border, background: receiptLayoutTone.background }}>
                <div style={{ fontWeight: 700, color: receiptLayoutTone.color, marginBottom: 4 }}>PDF Layout: {receiptLayoutLabel}</div>
                <div className="small" style={{ margin: 0 }}>
                  {receiptLayout.rawStatus === 'fit'
                    ? 'Wrapped service notes and location lines still fit inside the main receipt copy.'
                    : receiptLayout.rawStatus === 'warning'
                      ? `The receipt is within ${Math.max(0, Math.round(receiptLayout.rawRemainingBottomMargin))}pt of the footer. One or two more wrapped lines may push it into the bottom section.`
                      : `The current notes/details exceed the main receipt body by about ${Math.round(Math.abs(receiptLayout.rawRemainingBottomMargin))}pt.`}
                </div>
                {form.continueOnAttachment && receiptLayout.usesAttachment && (
                  <div className="small" style={{ marginTop: 6 }}>
                    Attachment page enabled. The PDF will keep page 1 clean and move the full service notes and/or location list to a separate attachment page.
                  </div>
                )}
              </div>
            </div>
            <div>
              <label>Locations / Units Serviced</label>
              <textarea name="locationList" value={form.locationList} onChange={handleInput} onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} rows={3} placeholder={"e.g. Building A - Units 101-110\nBuilding B - Units 201-210\n25 detached garages"} style={{ minHeight: 72, resize: 'none', overflow: 'hidden' }} />
              <div className="small" style={{ marginTop: 6, color: 'var(--muted)' }}>
                Use this for address lists, unit numbers, wings, rooms, or large property-manager scopes instead of cramming them into service notes.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'start', gap: 10, marginBottom: 0, cursor: 'pointer', color: 'var(--text)' }}>
              <input type="checkbox" name="continueOnAttachment" checked={Boolean(form.continueOnAttachment)} onChange={handleInput} style={{ marginTop: 3 }} />
              <span>
                <span style={{ fontWeight: 700, display: 'block' }}>Continue notes on attachment page if details run long</span>
                <span className="small" style={{ color: 'var(--muted)' }}>Keeps the main receipt copy clean and adds a separate PDF attachment page for oversized service notes or location lists.</span>
              </span>
            </label>
            <div className="row">
              <div>
                <label style={{ color: 'var(--text)', fontWeight: 700 }}>Total Cost</label>
                <input type="text" name="cost" value={form.cost} onChange={handleInput} required style={{ fontWeight: 700, color: 'var(--good)' }} />
              </div>
              <div><label>Received By</label><input type="text" name="receivedBy" value={form.receivedBy} onChange={handleInput} /></div>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: 4 }}>Services Provided</div>
            {[
              { id: 'interiorExterior', label: 'Interior/Exterior Cleaning' },
              { id: 'exterior', label: 'Exterior Cleaning' },
              { id: 'interior', label: 'Interior Cleaning' },
              { id: 'pressureWashing', label: 'Pressure Washing/Soft Washing' },
              { id: 'screenCleaning', label: 'Screen Cleaning' },
              { id: 'hardWater', label: 'Hard Water Removal' },
              { id: 'construction', label: 'Construction/Paint Removal' },
              { id: 'gutter', label: 'Gutter Cleaning' },
              { id: 'other', label: 'Other' }
            ].map(s => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', cursor: 'pointer', marginBottom: 0 }}>
                <input type="checkbox" name={s.id} checked={services[s.id]} onChange={handleService} />
                {s.label}
              </label>
            ))}
            {services.other && (
              <div style={{ marginTop: 6 }}>
                <label>Describe other service</label>
                <textarea name="otherServiceText" value={form.otherServiceText} onChange={handleInput} onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} rows={2} placeholder={"e.g. Track Cleaning\nAdditional detail..."} style={{ minHeight: 44, resize: 'none', overflow: 'hidden' }} />
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: 20, overflowX: 'auto' }}>
          <div style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: 12 }}>CSV Layout Preview</div>
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <tbody>
              {previewGrid.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ border: '1px solid var(--border)', padding: '2px 6px', minWidth: 72, verticalAlign: 'top', color: cell ? 'var(--text)' : 'var(--border)' }}>
                      {cell || '\u00B7'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={downloadPDF} style={{ background: 'var(--panel)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
            Download PDF
          </button>
          <button type="submit" style={{ background: 'var(--accent)', color: '#0b1020', border: 'none', borderRadius: 12, padding: '12px 28px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
            Download CSV
          </button>
        </div>
      </form>
    </div>
  );
}

// â”€â”€â”€ AUTH SCREENS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ChangePasswordScreen({ onSuccess }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async e => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    setError('');
    setSubmitting(true);
    try {
      // CSRF is needed for this POST
      await apiFetch('/api/csrf-token', undefined, { silent: true }).then(d => { if (d?.token) _csrfToken = d.token; }).catch(() => { });
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
      });
      onSuccess();
    } catch (err) {
      setError(err?.message || 'Failed to change password. Check your current password and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div className="card" style={{ maxWidth: 420, width: '100%', padding: '36px 32px' }}>
        <h2 style={{ margin: '0 0 6px', color: 'var(--accent)', fontSize: 22 }}>FieldOps Demo CRM</h2>
        <div className="sub" style={{ marginBottom: 24 }}>You must set a new password before continuing.</div>
        {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label>Current Password</label>
            <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required autoFocus />
          </div>
          <div className="modal-field">
            <label>New Password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
          </div>
          <div className="modal-field">
            <label>Confirm New Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-accent" style={{ width: '100%', marginTop: 12 }} disabled={submitting}>
            {submitting ? 'Updatingâ€¦' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

// â”€â”€â”€ REQUEST DELETE MODAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RequestDeleteModal({ recordType, recordId, recordLabel, onClose, onRequested }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const typeLabel = { customer: 'Customer', job: 'Service Job', recurringJob: 'Recurring Job' }[recordType] || 'Record';
  // Map frontend recordType to backend target_kind enum values
  const targetKind = { customer: 'customer', job: 'service_job', recurringJob: 'customer_job' }[recordType] || '';

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const thread = await apiFetch('/api/v1/admin-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadType: 'deletion_request',
          subject: `Delete request: ${typeLabel} â€” ${recordLabel}`,
          targetKind,
          targetId: String(recordId),
          initialMessage: reason.trim() || `Requesting deletion of ${typeLabel}: ${recordLabel}`,
        }),
      });
      onRequested(thread);
    } catch (err) {
      setError(err?.message || 'Failed to submit deletion request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Request Deletion</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div>
          <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--panel-soft)', border: '1px solid var(--border)', marginBottom: 16 }}>
            <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>Requesting deletion of</div>
            <div style={{ fontWeight: 600 }}>{typeLabel}: {recordLabel}</div>
          </div>
          {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="modal-field">
              <label>Reason (optional)</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Describe why this record should be deletedâ€¦"
                rows={4}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-danger" disabled={submitting}>
                {submitting ? 'Submittingâ€¦' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ ADMIN MESSENGER TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function AdminMessengerTab({ currentUser, onDeleteExecuted }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadDetail, setThreadDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [composeError, setComposeError] = useState('');
  const [actionInProgress, setActionInProgress] = useState(null); // 'reject' | 'execute-delete' | null

  const isAdmin = currentUser?.role === 'admin' || Boolean(currentUser?.permissions?.canExecuteDelete);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/api/v1/admin-threads');
      setThreads(Array.isArray(data?.threads) ? data.threads : (Array.isArray(data) ? data : []));
    } catch (err) {
      setError(err?.message || 'Failed to load threads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const loadThreadDetail = useCallback(async id => {
    setDetailLoading(true);
    try {
      const data = await apiFetch(`/api/v1/admin-threads/${id}`);
      setThreadDetail(data);
    } catch (err) {
      setError(err?.message || 'Failed to load thread detail.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openThread = thread => {
    setSelectedThread(thread);
    setReplyText('');
    setError('');
    loadThreadDetail(thread.id);
  };

  const backToList = () => {
    setSelectedThread(null);
    setThreadDetail(null);
    setComposing(false);
    setError('');
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedThread) return;
    setReplying(true);
    try {
      await apiFetch(`/api/v1/admin-threads/${selectedThread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      setReplyText('');
      await loadThreadDetail(selectedThread.id);
      loadThreads();
    } catch (err) {
      setError(err?.message || 'Failed to send reply.');
    } finally {
      setReplying(false);
    }
  };

  const handleThreadAction = async action => {
    if (!selectedThread || !isAdmin) return;
    setActionInProgress(action);
    try {
      if (action === 'reject') {
        // Reject uses PATCH { status: 'rejected' }
        await apiFetch(`/api/v1/admin-threads/${selectedThread.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'rejected' }),
        });
      } else {
        // execute-delete has its own POST route
        await apiFetch(`/api/v1/admin-threads/${selectedThread.id}/${action}`, { method: 'POST' });
      }
      await loadThreadDetail(selectedThread.id);
      loadThreads();
      if (action === 'execute-delete' && onDeleteExecuted) onDeleteExecuted();
    } catch (err) {
      setError(err?.message || 'Action failed.');
    } finally {
      setActionInProgress(null);
    }
  };

  const sendNewThread = async () => {
    if (!draftSubject.trim()) { setComposeError('Subject is required.'); return; }
    if (!draftBody.trim()) { setComposeError('Message is required.'); return; }
    setComposeError('');
    setReplying(true);
    try {
      const thread = await apiFetch('/api/v1/admin-threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadType: 'message', subject: draftSubject.trim(), initialMessage: draftBody.trim() }),
      });
      setComposing(false);
      setDraftSubject('');
      setDraftBody('');
      await loadThreads();
      if (thread?.id) openThread(thread);
    } catch (err) {
      setComposeError(err?.message || 'Failed to create thread.');
    } finally {
      setReplying(false);
    }
  };

  const pendingDeleteRequests = useMemo(
    () => threads.filter(t => t.threadType === 'deletion_request' && t.status === 'open'),
    [threads]
  );

  const threadRef = threadDetail || selectedThread;

  return (
    <div>
      <div className="title-row">
        <div>
          <div className="pill">Messenger</div>
          <h2>Admin Messenger</h2>
          <div className="sub">Internal threads, deletion requests, and team communications.</div>
        </div>
        {!selectedThread && !composing && (
          <button className="btn btn-accent" onClick={() => setComposing(true)}>+ New Thread</button>
        )}
        {(selectedThread || composing) && (
          <button className="btn" onClick={backToList}>â† All Threads</button>
        )}
      </div>

      {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Compose */}
      {composing && !selectedThread && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>New Thread</h3>
          {composeError && <div className="alert" style={{ marginBottom: 12 }}>{composeError}</div>}
          <div className="modal-field">
            <label>Subject</label>
            <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)} placeholder="Thread subjectâ€¦" />
          </div>
          <div className="modal-field">
            <label>Message</label>
            <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} placeholder="Write your messageâ€¦" rows={5} style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => { setComposing(false); setComposeError(''); }}>Cancel</button>
            <button className="btn btn-accent" onClick={sendNewThread} disabled={replying}>
              {replying ? 'Sendingâ€¦' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Thread list */}
      {!selectedThread && !composing && (
        <>
          {isAdmin && pendingDeleteRequests.length > 0 && (
            <div className="card" style={{ marginBottom: 18, borderColor: 'rgba(255,107,107,0.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>Pending Deletion Requests</span>
                <span className="badge badge-danger">{pendingDeleteRequests.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {pendingDeleteRequests.map(t => {
                  const creator = t.participants?.find(p => p.id === t.createdByUserId);
                  return (
                    <div key={t.id}
                      onClick={() => openThread(t)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,107,107,0.25)', background: 'rgba(255,107,107,0.04)', cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{t.subject || 'Deletion Request'}</div>
                        {t.targetKind && <div className="small" style={{ color: 'var(--muted)', marginTop: 2 }}>{t.targetKind} Â· {t.targetId}</div>}
                      </div>
                      <div className="small" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{creator?.displayName || 'Employee'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="card">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>Loading threadsâ€¦</div>
            ) : threads.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>No threads yet. Start a new conversation above.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {threads.map(t => {
                  const creator = t.participants?.find(p => p.id === t.createdByUserId);
                  return (
                    <div key={t.id}
                      onClick={() => openThread(t)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-soft)', cursor: 'pointer', transition: 'border-color 0.1s' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {t.threadType === 'deletion_request' && <span className="badge badge-danger" style={{ fontSize: 11 }}>Delete Request</span>}
                          {t.status === 'resolved' && <span className="badge badge-good" style={{ fontSize: 11 }}>Resolved</span>}
                          {t.status === 'rejected' && <span className="badge" style={{ fontSize: 11 }}>Rejected</span>}
                          {t.status === 'executed' && <span className="badge badge-good" style={{ fontSize: 11 }}>Executed</span>}
                          <span style={{ fontWeight: 600 }}>{t.subject || '(no subject)'}</span>
                        </div>
                        {t.targetKind && <div className="small" style={{ color: 'var(--muted)', marginTop: 3 }}>{t.targetKind} Â· {t.targetId}</div>}
                        <div className="small" style={{ color: 'var(--muted)', marginTop: 3 }}>From: {creator?.displayName || 'â€”'}</div>
                      </div>
                      <div className="small" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatLedgerTimestamp(t.latestMessageAt || t.updatedAt || t.createdAt)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Thread detail */}
      {selectedThread && !composing && (
        <div className="card">
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                {selectedThread.threadType === 'deletion_request' && <span className="badge badge-danger">Delete Request</span>}
                {threadRef?.status === 'resolved' && <span className="badge badge-good">Resolved</span>}
                {threadRef?.status === 'rejected' && <span className="badge">Rejected</span>}
                {threadRef?.status === 'executed' && <span className="badge badge-good">Executed</span>}
                <h3 style={{ margin: 0 }}>{selectedThread.subject || '(no subject)'}</h3>
              </div>
              {threadRef?.targetKind && (
                <div className="small" style={{ color: 'var(--muted)' }}>
                  {threadRef.targetKind} Â· {threadRef.targetId}
                </div>
              )}
              <div className="small" style={{ color: 'var(--muted)', marginTop: 2 }}>
                Started by {threadRef?.participants?.find(p => p.id === threadRef?.createdByUserId)?.displayName || 'â€”'}
              </div>
            </div>
            {isAdmin && selectedThread.threadType === 'deletion_request' && threadDetail?.status === 'open' && (
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button className="btn btn-sm" onClick={() => handleThreadAction('reject')} disabled={!!actionInProgress}>
                  {actionInProgress === 'reject' ? 'â€¦' : 'Reject'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => handleThreadAction('execute-delete')} disabled={!!actionInProgress}>
                  {actionInProgress === 'execute-delete' ? 'Executingâ€¦' : 'Execute Delete'}
                </button>
              </div>
            )}
          </div>

          {/* Messages */}
          {detailLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)' }}>Loadingâ€¦</div>
          ) : (
            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              {(threadDetail?.messages || []).length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 14 }}>No messages yet.</div>
              )}
              {(threadDetail?.messages || []).map(msg => {
                const isSystem = msg.messageType === 'system';
                const isOwn = msg.authorUserId === currentUser?.id;
                const authorName = msg.author?.displayName || msg.author?.username || 'â€”';
                return (
                  <div key={msg.id} style={{
                    padding: '10px 14px', borderRadius: 8,
                    border: isSystem ? '1px dashed var(--border)' : '1px solid var(--border)',
                    background: isSystem ? 'transparent' : (isOwn ? 'rgba(110,168,254,0.06)' : 'var(--panel-soft)'),
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                      <span style={{ fontWeight: isSystem ? 400 : 600, color: isSystem ? 'var(--muted)' : 'var(--text)', fontSize: isSystem ? 13 : 14, fontStyle: isSystem ? 'italic' : 'normal' }}>
                        {isSystem ? 'âš™ System' : authorName}
                      </span>
                      <span className="small" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatLedgerTimestamp(msg.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.message}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Reply â€” only if thread is still open */}
          {threadDetail?.status !== 'resolved' && threadDetail?.status !== 'rejected' && threadDetail?.status !== 'executed' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); }}
                placeholder="Write a replyâ€¦ (Ctrl+Enter to send)"
                rows={3}
                style={{ flex: 1, resize: 'vertical', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', fontSize: 14 }}
              />
              <button className="btn btn-accent" onClick={sendReply} disabled={replying || !replyText.trim()}>
                {replying ? 'â€¦' : 'Send'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// â”€â”€â”€ PRICING EDITOR TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PricingEditorTab() {
  const STORAGE_KEY = 'crm_pricing_config';

  const [draft, setDraft] = React.useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeEstimatePricingConfig(JSON.parse(saved));
    } catch { }
    return cloneEstimatePricingConfig();
  });
  const [saveStatus, setSaveStatus] = React.useState('idle');

  function set(keys, value) {
    setDraft(prev => {
      const next = cloneEstimatePricingConfig(prev);
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return next;
    });
    setSaveStatus('unsaved');
  }

  function setMatrixRow(index, field, value) {
    setDraft(prev => {
      const next = cloneEstimatePricingConfig(prev);
      next.commercialFrequencyMatrix.rows = next.commercialFrequencyMatrix.rows.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      );
      return next;
    });
    setSaveStatus('unsaved');
  }

  function handleSave() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      setSaveStatus('saved');
    } catch (e) {
      alert('Failed to save: ' + e.message);
    }
  }

  function handleReset() {
    if (!confirm('Reset all pricing to built-in defaults? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    setDraft(cloneEstimatePricingConfig());
    setSaveStatus('idle');
  }

  const F = ({ label, path, step, note }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
        {label}{note && <span style={{ fontWeight: 400, marginLeft: 4 }}>({note})</span>}
      </label>
      <input
        type="number"
        min="0"
        step={step || '0.01'}
        value={path.reduce((obj, k) => obj[k], draft)}
        onChange={e => set(path, parseFloat(e.target.value) || 0)}
        style={{ padding: '6px 8px', width: '100%', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}
      />
    </div>
  );

  const gridTwo = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Pricing Configuration</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Changes apply to new estimates only â€” previously saved jobs and receipts are not affected.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 16 }}>
          {saveStatus === 'unsaved' && <span style={{ fontSize: 12, color: 'var(--warn)' }}>Unsaved changes</span>}
          {saveStatus === 'saved' && <span style={{ fontSize: 12, color: 'var(--good)' }}>Saved âœ“</span>}
          <button className="btn" onClick={handleReset}>Reset to Defaults</button>
          <button className="btn btn-accent" onClick={handleSave}>Save Changes</button>
        </div>
      </div>

      {saveStatus === 'saved' && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(60,179,113,0.1)', border: '1px solid var(--good)', borderRadius: 6, fontSize: 13, color: 'var(--good)' }}>
          Pricing saved. Switch to New Estimate Calculator to apply the updated rates.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        <section className="card">
          <h4 style={{ margin: '0 0 12px' }}>General</h4>
          <F label="Minimum Charge" path={['minimumCharge']} note="$" />
        </section>

        <section className="card">
          <h4 style={{ margin: '0 0 12px' }}>Service Level Multipliers</h4>
          <div style={gridTwo}>
            <F label="Inside & Outside" path={['serviceLevelMultipliers', 'both']} note="Ã— base" />
            <F label="Exterior Only" path={['serviceLevelMultipliers', 'ext']} note="Ã— base" />
          </div>
        </section>

        <section className="card">
          <h4 style={{ margin: '0 0 8px' }}>Residential â€” Windows <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>per pane</span></h4>
          <div style={gridTwo}>
            <F label="Double-Hung" path={['propertyTypes', 'res', 'windows', 'doubleHung']} note="$" />
            <F label="Small Pane / French Pane" path={['propertyTypes', 'res', 'windows', 'smallPane']} note="$" />
            <F label="Casement" path={['propertyTypes', 'res', 'windows', 'casement']} note="$" />
            <F label="Picture" path={['propertyTypes', 'res', 'windows', 'picture']} note="$" />
            <F label="Storm" path={['propertyTypes', 'res', 'windows', 'storm']} note="$" />
            <F label="Skylight" path={['propertyTypes', 'res', 'windows', 'skylight']} note="$" />
          </div>
          <h4 style={{ margin: '14px 0 8px' }}>Residential â€” Extras <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>per unit</span></h4>
          <div style={gridTwo}>
            <F label="Screen Cleaning" path={['propertyTypes', 'res', 'extras', 'screens']} note="$" />
            <F label="Track Cleaning" path={['propertyTypes', 'res', 'extras', 'tracks']} note="$" />
            <F label="Upper Floor Surcharge" path={['propertyTypes', 'res', 'extras', 'upperFloorAccess']} note="$" />
          </div>
        </section>

        <section className="card">
          <h4 style={{ margin: '0 0 8px' }}>Commercial â€” Windows <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>per pane</span></h4>
          <div style={gridTwo}>
            <F label="Double-Hung" path={['propertyTypes', 'com', 'windows', 'doubleHung']} note="$" />
            <F label="Small Pane / French Pane" path={['propertyTypes', 'com', 'windows', 'smallPane']} note="$" />
            <F label="Casement" path={['propertyTypes', 'com', 'windows', 'casement']} note="$" />
            <F label="Picture" path={['propertyTypes', 'com', 'windows', 'picture']} note="$" />
            <F label="Storm" path={['propertyTypes', 'com', 'windows', 'storm']} note="$" />
            <F label="Skylight" path={['propertyTypes', 'com', 'windows', 'skylight']} note="$" />
          </div>
          <h4 style={{ margin: '14px 0 8px' }}>Commercial â€” Extras <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>per unit</span></h4>
          <div style={gridTwo}>
            <F label="Screen Cleaning" path={['propertyTypes', 'com', 'extras', 'screens']} note="$" />
            <F label="Track Cleaning" path={['propertyTypes', 'com', 'extras', 'tracks']} note="$" />
            <F label="Upper Floor Surcharge" path={['propertyTypes', 'com', 'extras', 'upperFloorAccess']} note="$" />
          </div>
        </section>

        <section className="card">
          <h4 style={{ margin: '0 0 12px' }}>Add-on Services</h4>
          <div style={gridTwo}>
            <F label="Pressure Washing" path={['addons', 'pressure', 'rate']} note="$/wall" />
            <F label="Gutter Cleaning" path={['addons', 'gutter', 'rate']} note="$/wall" />
            <F label="Gutter Wall Multiplier" path={['addons', 'gutter', 'multiplier']} note="Ã— walls" />
            <F label="Caulking / Sealing" path={['addons', 'caulk', 'rate']} note="$/hr" />
          </div>
        </section>

        <section className="card">
          <h4 style={{ margin: '0 0 12px' }}>Adjustments <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>window multiplier plus flat rate items</span></h4>
          <div style={gridTwo}>
            <F label="Hard Water Removal" path={['adjustments', 'hardWater', 'multiplier']} note="Ã— avg selected window price" />
            <F label="Construction / Paint Removal" path={['adjustments', 'paintDebris', 'flat']} note="$ ea" />
            <F label="Ladder Access" path={['adjustments', 'ladderWork', 'flat']} note="$ ea" />
            <F label="Manual Skylight Cleaning" path={['adjustments', 'manualSkylightCleaning', 'flat']} note="$ ea" />
            <F label="Light Fixtures / Fans" path={['adjustments', 'lightFixture', 'flat']} note="$ ea" />
          </div>
        </section>

      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h4 style={{ margin: '0 0 12px' }}>Commercial Frequency Matrix</h4>
        <div style={{ ...gridTwo, marginBottom: 16 }}>
          <F label="Exterior Only Column Multiplier" path={['commercialFrequencyMatrix', 'extMultiplier']} note="Ã— base" />
          <F label="Storefront I/E Column Multiplier" path={['commercialFrequencyMatrix', 'storefrontMultiplier']} note="Ã— base" />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Frequency Label</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Rate Multiplier (Ã— base)</th>
            </tr>
          </thead>
          <tbody>
            {draft.commercialFrequencyMatrix.rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '5px 8px' }}>
                  <input
                    type="text"
                    value={row.label}
                    onChange={e => setMatrixRow(i, 'label', e.target.value)}
                    style={{ padding: '5px 8px', width: '100%', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}
                  />
                </td>
                <td style={{ padding: '5px 8px' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.multiplier}
                    onChange={e => setMatrixRow(i, 'multiplier', parseFloat(e.target.value) || 0)}
                    style={{ padding: '5px 8px', width: '100%', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const DEFAULT_ESTIMATE_BUILDER_SNAPSHOT = Object.freeze({
  revenue: 0,
  calculatedRevenue: 0,
  hasRevenue: false,
  hasScope: false,
  manualOverrideActive: false,
  estimateType: 'new',
  propertyType: 'res',
  customerName: '',
  address: '',
  routeAddress: '',
  travelRouteStatus: 'idle',
  travelOneWayMiles: 0,
  travelRoundTripMiles: 0,
  travelDurationMin: 0,
  travelRouteError: '',
  travelRouteLabel: '',
  label: 'Unsaved estimate builder quote',
});

// â”€â”€â”€ NAVIGATION & ROUTING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MODULES = [
  { id: 'dashboard', label: 'Executive Dashboard' },
  { id: 'estimates', label: 'Estimates' },
  { id: 'customers', label: 'Customers' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'financials', label: 'Financials' },
  { id: 'settings', label: 'Settings' },
];

const SUBVIEWS = {
  dashboard: [
    { id: 'overview', label: 'Overview' },
    { id: 'price_analysis', label: 'Price Analysis' },
    { id: 'price_config', label: 'Price Config' },
    { id: 'business_graphs', label: 'Business Graphs' },
  ],
  estimates: [
    { id: 'builder', label: 'Estimate Builder' },
    { id: 'intake_queue', label: 'Intake Queue' },
  ],
  customers: [
    { id: 'directory', label: 'Directory' },
    { id: 'map', label: 'Map' },
    { id: 'routes', label: 'Routes' },
    { id: 'job_receipts', label: 'Job Invoice / Receipt Generator' },
  ],
  scheduling: [
    { id: 'calendar', label: 'Calendar' },
    { id: 'dispatch_board', label: 'Dispatch Board' },
    { id: 'route_recommendations', label: 'Route Recommendations' },
  ],
  jobs: [
    { id: 'active', label: 'Active' },
    { id: 'outstanding', label: 'Outstanding Jobs' },
    { id: 'recurring', label: 'Recurring' },
    { id: 'completed', label: 'Completed' },
  ],
  financials: [
    { id: 'income', label: 'Income' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'expense_analysis', label: 'Expense Analysis' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'reports', label: 'Reports' },
  ],
  settings: [
    { id: 'general', label: 'General' },
  ],
};

const DEFAULT_SUBVIEW = {
  dashboard: 'overview',
  estimates: 'builder',
  customers: 'directory',
  scheduling: 'calendar',
  jobs: 'active',
  financials: 'income',
  settings: 'general',
};

const legacyRoutes = {
  dashboard: ['dashboard', 'overview'],
  overview: ['dashboard', 'overview'],
  estimates: ['estimates', 'builder'],
  estimate: ['estimates', 'builder'],
  builder: ['estimates', 'builder'],
  intake: ['estimates', 'intake_queue'],
  intake_queue: ['estimates', 'intake_queue'],
  profit: ['dashboard', 'price_analysis'],
  profit_analysis: ['dashboard', 'price_analysis'],
  price_analysis: ['dashboard', 'price_analysis'],
  pricing: ['dashboard', 'price_config'],
  pricing_config: ['dashboard', 'price_config'],
  price_config: ['dashboard', 'price_config'],
  database: ['customers', 'directory'],
  customers: ['customers', 'directory'],
  directory: ['customers', 'directory'],
  map: ['customers', 'map'],
  routes: ['customers', 'routes'],
  ltv: ['customers', 'directory'],
  receipts: ['customers', 'job_receipts'],
  receipt: ['customers', 'job_receipts'],
  job_receipts: ['customers', 'job_receipts'],
  invoice: ['customers', 'job_receipts'],
  invoices: ['customers', 'job_receipts'],
  calendar: ['scheduling', 'calendar'],
  scheduling: ['scheduling', 'calendar'],
  dispatch: ['scheduling', 'dispatch_board'],
  google_sync: ['settings', 'general'],
  route_recommendations: ['scheduling', 'route_recommendations'],
  jobs: ['jobs', 'active'],
  active_jobs: ['jobs', 'active'],
  outstanding: ['jobs', 'outstanding'],
  outstanding_jobs: ['jobs', 'outstanding'],
  recurring: ['jobs', 'recurring'],
  completed: ['jobs', 'completed'],
  financials: ['financials', 'income'],
  income: ['financials', 'income'],
  expenses: ['financials', 'expenses'],
  expense_analysis: ['financials', 'expense_analysis'],
  payroll: ['financials', 'payroll'],
  reports: ['financials', 'reports'],
  settings: ['settings', 'general'],
};

function getModuleSubviews(moduleId) {
  return Array.isArray(SUBVIEWS[moduleId]) ? SUBVIEWS[moduleId] : [];
}

function resolveRoute(moduleId, subviewId) {
  const moduleExists = MODULES.some(module => module.id === moduleId);
  const safeModule = moduleExists ? moduleId : 'dashboard';
  const moduleSubviews = getModuleSubviews(safeModule);
  const defaultSubview = DEFAULT_SUBVIEW[safeModule] || moduleSubviews[0]?.id || 'overview';
  const subviewExists = moduleSubviews.some(subview => subview.id === subviewId);
  return {
    module: safeModule,
    subview: subviewExists ? subviewId : defaultSubview,
  };
}

function hasOutstandingOperationalGap(job) {
  if (!job) return false;
  const status = String(job.status || '').trim();
  if (status !== 'Scheduled' && status !== 'In Progress') return false;
  return !String(job.customerId || '').trim()
    || !String(job.serviceType || '').trim()
    || !String(job.scheduledDate || '').trim();
}

function isOutstandingJob(job) {
  if (!job) return false;
  const status = String(job.status || '').trim();
  const paymentStatus = getJobPaymentStatus(job);
  const invoiceSent = isJobInvoiceSent(job);
  if (status === 'Completed' && paymentStatus !== 'Paid') return true;
  if (status === 'Completed' && !invoiceSent) return true;
  if (paymentStatus === 'Net-30') return true;
  return hasOutstandingOperationalGap(job);
}

function getOutstandingJobReason(job) {
  if (!job) return 'Requires review';
  const status = String(job.status || '').trim();
  const paymentStatus = getJobPaymentStatus(job);
  const invoiceSent = isJobInvoiceSent(job);
  if (paymentStatus === 'Net-30') return 'Net-30 payment still pending';
  if (status === 'Completed' && paymentStatus !== 'Paid' && !invoiceSent) return 'Completed, unpaid, and invoice not sent';
  if (status === 'Completed' && paymentStatus !== 'Paid') return 'Completed but not fully paid';
  if (status === 'Completed' && !invoiceSent) return 'Completed but invoice not sent';
  if (!String(job.customerId || '').trim()) return 'Missing customer assignment';
  if (!String(job.serviceType || '').trim()) return 'Missing service type';
  if (!String(job.scheduledDate || '').trim()) return 'Missing scheduled date';
  return 'Requires operational follow-up';
}

// â”€â”€â”€ SHARED UTILITY COMPONENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PlaceholderPanel({
  eyebrow = 'Safe Placeholder',
  title,
  description,
  actionLabel = '',
  onAction = null,
  secondaryActionLabel = '',
  onSecondaryAction = null,
  children = null,
}) {
  return (
    <div className="card">
      <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{eyebrow}</div>
      <h2 style={{ marginTop: 8, marginBottom: 8 }}>{title}</h2>
      <div className="sub" style={{ marginBottom: children ? 18 : 0 }}>{description}</div>
      {children}
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex-row" style={{ marginTop: 18 }}>
          {actionLabel && <button className="btn btn-accent" onClick={onAction}>{actionLabel}</button>}
          {secondaryActionLabel && <button className="btn btn-sm" onClick={onSecondaryAction}>{secondaryActionLabel}</button>}
        </div>
      )}
    </div>
  );
}

function JobListSummaryTable({
  title,
  description,
  jobs,
  customers,
  emptyMessage,
  reasonForJob = null,
}) {
  const customerById = useMemo(() => {
    const next = new Map();
    (customers || []).forEach(customer => next.set(String(customer.id), customer));
    return next;
  }, [customers]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <div className="sub" style={{ marginTop: 4 }}>{description}</div>
        </div>
        <span className="badge">{jobs.length}</span>
      </div>

      {jobs.length === 0 ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '28px 20px', background: 'var(--panel-soft)', borderRadius: 10 }}>
          {emptyMessage}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Job #</th>
                <th>Customer</th>
                <th>Service</th>
                <th>Date</th>
                <th>Status</th>
                <th>Financials</th>
                {reasonForJob && <th>Why Outstanding</th>}
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => {
                const customer = customerById.get(String(job.customerId));
                const paymentStatus = getJobPaymentStatus(job);
                const invoiceSent = isJobInvoiceSent(job);
                return (
                  <tr key={job.id}>
                    <td className="mono">#{job.jobNumber || job.id}</td>
                    <td style={{ fontWeight: 600 }}>{customer?.name || 'Unknown Customer'}</td>
                    <td>
                      <div>{job.serviceType || 'Service pending'}</div>
                      {job.address && <div className="small" style={{ marginTop: 2 }}>{job.address}</div>}
                    </td>
                    <td className="mono">{job.scheduledDate || 'Unscheduled'}</td>
                    <td>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <span className={`badge ${jobStatusClass(job.status)}`}>{job.status || 'Unknown'}</span>
                        <span className={`badge ${jobPaymentStatusClass(paymentStatus)}`}>{paymentStatus}</span>
                        <span className="small" style={{ color: invoiceSent ? 'var(--good)' : 'var(--danger)' }}>
                          {invoiceSent ? 'Invoice sent' : 'Invoice not sent'}
                        </span>
                      </div>
                    </td>
                    <td className="mono">
                      <div>{money(Number(job.actualAmount) || Number(job.quotedAmount) || 0)}</div>
                      <div className="small" style={{ marginTop: 4 }}>Overhead: {money(Number(job.overheadSpent) || 0)}</div>
                    </td>
                    {reasonForJob && <td>{reasonForJob(job)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function getBusinessGraphTrackedOverhead(job) {
  return Math.max(0, Number(job?.overheadSpent) || 0);
}

function getBusinessGraphJobProfit(job) {
  return getPayrollJobAmount(job) - getBusinessGraphTrackedOverhead(job);
}

function getBusinessGraphJobMargin(job) {
  const completedValue = getPayrollJobAmount(job);
  return completedValue > 0 ? getBusinessGraphJobProfit(job) / completedValue : 0;
}

function getBusinessGraphDateValue(job) {
  return job?.scheduledDate || job?.completedAt || job?.createdAt || '';
}

function getBusinessGraphMonthKey(dateValue) {
  const raw = String(dateValue || '').trim();
  if (!raw) return '';
  const parts = raw.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) return `${parts[0]}-${parts[1]}`;
    if (parts[2].length === 4) return `${parts[2]}-${String(parts[0] || '').padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function buildBusinessGraphChartBuckets(jobs) {
  const next = new Map();
  (jobs || []).forEach(job => {
    const monthKey = getBusinessGraphMonthKey(getBusinessGraphDateValue(job));
    if (!monthKey) return;
    if (!next.has(monthKey)) {
      next.set(monthKey, {
        month: monthKey,
        completedWorkValue: 0,
        completedTrackedOverhead: 0,
        jobCount: 0,
      });
    }
    const bucket = next.get(monthKey);
    bucket.completedWorkValue += getPayrollJobAmount(job);
    bucket.completedTrackedOverhead += getBusinessGraphTrackedOverhead(job);
    bucket.jobCount += 1;
  });
  return [...next.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function buildBusinessGraphServiceTypeData(jobs) {
  const next = new Map();
  (jobs || []).forEach(job => {
    const serviceType = String(job?.serviceType || '').trim() || 'Unknown Service';
    if (!next.has(serviceType)) {
      next.set(serviceType, {
        serviceType,
        completedWorkValue: 0,
        completedTrackedOverhead: 0,
        jobCount: 0,
      });
    }
    const row = next.get(serviceType);
    row.completedWorkValue += getPayrollJobAmount(job);
    row.completedTrackedOverhead += getBusinessGraphTrackedOverhead(job);
    row.jobCount += 1;
  });
  return [...next.values()]
    .map(row => {
      const estimatedCompletedProfit = row.completedWorkValue - row.completedTrackedOverhead;
      return {
        ...row,
        estimatedCompletedProfit,
        estimatedCompletedMargin: row.completedWorkValue > 0 ? estimatedCompletedProfit / row.completedWorkValue : 0,
        averageWorkValue: row.jobCount > 0 ? row.completedWorkValue / row.jobCount : 0,
      };
    })
    .sort((a, b) => b.completedWorkValue - a.completedWorkValue);
}

// â”€â”€â”€ BUSINESS GRAPHS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function BusinessGraphsTab({ customers, serviceJobs, navigateTo }) {
  const completedJobs = useMemo(() => (serviceJobs || []).filter(job => job.status === 'Completed'), [serviceJobs]);
  const paidCompletedJobs = useMemo(() => completedJobs.filter(isJobPaid), [completedJobs]);
  const unpaidCompletedJobs = useMemo(() => completedJobs.filter(job => !isJobPaid(job)), [completedJobs]);
  const activeLeads = useMemo(() => (customers || []).filter(customer => String(customer.status || '').toLowerCase() === 'lead'), [customers]);

  const completedWorkValue = useMemo(() => completedJobs.reduce((sum, job) => sum + getPayrollJobAmount(job), 0), [completedJobs]);
  const collectedRevenue = useMemo(() => paidCompletedJobs.reduce((sum, job) => sum + getPayrollJobAmount(job), 0), [paidCompletedJobs]);
  const completedTrackedOverhead = useMemo(() => completedJobs.reduce((sum, job) => sum + getBusinessGraphTrackedOverhead(job), 0), [completedJobs]);
  const paidTrackedOverhead = useMemo(() => paidCompletedJobs.reduce((sum, job) => sum + getBusinessGraphTrackedOverhead(job), 0), [paidCompletedJobs]);
  const unpaidCompletedRevenue = useMemo(() => unpaidCompletedJobs.reduce((sum, job) => sum + getPayrollJobAmount(job), 0), [unpaidCompletedJobs]);

  const estimatedCollectedProfit = collectedRevenue - paidTrackedOverhead;
  const estimatedCollectedMargin = collectedRevenue > 0 ? estimatedCollectedProfit / collectedRevenue : 0;
  const estimatedCompletedProfit = completedWorkValue - completedTrackedOverhead;
  const estimatedCompletedMargin = completedWorkValue > 0 ? estimatedCompletedProfit / completedWorkValue : 0;

  const monthlyChartBuckets = useMemo(() => buildBusinessGraphChartBuckets(completedJobs), [completedJobs]);
  const serviceTypeData = useMemo(() => buildBusinessGraphServiceTypeData(completedJobs), [completedJobs]);
  const weakestJobs = useMemo(() => {
    return completedJobs.slice()
      .sort((a, b) => {
        const marginDelta = getBusinessGraphJobMargin(a) - getBusinessGraphJobMargin(b);
        if (marginDelta !== 0) return marginDelta;
        return getPayrollJobAmount(b) - getPayrollJobAmount(a);
      })
      .slice(0, 5);
  }, [completedJobs]);
  const maxMonthlyChartValue = useMemo(() => {
    return monthlyChartBuckets.reduce((maxValue, bucket) => {
      return Math.max(maxValue, bucket.completedWorkValue, bucket.completedTrackedOverhead);
    }, 1);
  }, [monthlyChartBuckets]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div
        className="card"
        style={{ background: 'rgba(255, 179, 71, 0.08)', borderColor: 'rgba(255, 179, 71, 0.35)', borderLeft: '4px solid var(--warn)' }}
      >
        <strong style={{ display: 'block', marginBottom: 6, color: 'var(--warn)' }}>Data Accuracy Notice</strong>
        <div className="small" style={{ color: 'var(--text)', lineHeight: 1.6 }}>
          Collected metrics pair paid completed revenue with paid-job tracked overhead only. Completed-work metrics include all completed jobs, even if payment is still outstanding. Full business net profit still requires a real expense ledger for payroll, fuel, taxes, repairs, software, insurance, and other operating costs.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="small" style={{ color: 'var(--muted)' }}>Collected Revenue</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--good)', marginTop: 8 }}>{money(collectedRevenue)}</div>
        </div>
        <div className="card">
          <div className="small" style={{ color: 'var(--muted)' }}>Paid-Job Tracked Overhead</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--danger)', marginTop: 8 }}>{money(paidTrackedOverhead)}</div>
        </div>
        <div className="card">
          <div className="small" style={{ color: 'var(--muted)' }}>Estimated Collected Profit</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: estimatedCollectedProfit >= 0 ? 'var(--text)' : 'var(--danger)', marginTop: 8 }}>
            {money(estimatedCollectedProfit)}
          </div>
        </div>
        <div className="card">
          <div className="small" style={{ color: 'var(--muted)' }}>Estimated Collected Margin</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: estimatedCollectedMargin >= 0.3 ? 'var(--good)' : 'var(--warn)', marginTop: 8 }}>
            {pct(estimatedCollectedMargin)}
          </div>
        </div>
        <div className="card">
          <div className="small" style={{ color: 'var(--muted)' }}>Unpaid Completed Jobs</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: unpaidCompletedJobs.length > 0 ? 'var(--warn)' : 'var(--text)', marginTop: 8 }}>
            {unpaidCompletedJobs.length}
          </div>
        </div>
        <div className="card">
          <div className="small" style={{ color: 'var(--muted)' }}>Active Leads</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }}>{activeLeads.length}</div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 0 }}>
        <div className="card span-6">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Completed Work Value &amp; Tracked Overhead Trend</h3>
              <div className="small" style={{ color: 'var(--muted)', marginTop: 6 }}>
                Completed work: {money(completedWorkValue)} | Tracked overhead: {money(completedTrackedOverhead)} | Est. completed profit: {money(estimatedCompletedProfit)} ({pct(estimatedCompletedMargin)})
              </div>
            </div>
            <div className="small" style={{ color: 'var(--muted)' }}>Valid dated completed jobs only</div>
          </div>

          {monthlyChartBuckets.length < 2 ? (
            <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '32px 20px', background: 'var(--panel-soft)', borderRadius: 10 }}>
              Not enough dated completed jobs to build a monthly trend yet.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 220, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                {monthlyChartBuckets.map(bucket => (
                  <div key={bucket.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: '100%' }}>
                      <div
                        style={{
                          width: '40%',
                          background: 'var(--accent)',
                          height: bucket.completedWorkValue > 0 ? `${(bucket.completedWorkValue / maxMonthlyChartValue) * 100}%` : 0,
                          minHeight: bucket.completedWorkValue > 0 ? 4 : 0,
                          borderRadius: '4px 4px 0 0'
                        }}
                        title={`Completed Work Value: ${money(bucket.completedWorkValue)}`}
                      />
                      <div
                        style={{
                          width: '40%',
                          background: 'var(--danger)',
                          height: bucket.completedTrackedOverhead > 0 ? `${(bucket.completedTrackedOverhead / maxMonthlyChartValue) * 100}%` : 0,
                          minHeight: bucket.completedTrackedOverhead > 0 ? 4 : 0,
                          borderRadius: '4px 4px 0 0'
                        }}
                        title={`Tracked Overhead: ${money(bucket.completedTrackedOverhead)}`}
                      />
                    </div>
                    <div className="small" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 10 }}>{bucket.month}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 12, height: 12, background: 'var(--accent)', borderRadius: 2 }}></span>
                  Completed Work Value
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 12, height: 12, background: 'var(--danger)', borderRadius: 2 }}></span>
                  Tracked Overhead
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card span-6">
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Collections Pipeline</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ padding: 16, borderRadius: 10, background: 'var(--panel-soft)', border: '1px solid var(--border)' }}>
              <div className="small" style={{ color: 'var(--muted)' }}>Paid Completed Revenue</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--good)', marginTop: 4 }}>{money(collectedRevenue)}</div>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>{paidCompletedJobs.length} paid completed jobs</div>
            </div>

            <div style={{ padding: 16, borderRadius: 10, background: 'rgba(255, 179, 71, 0.08)', border: '1px solid rgba(255, 179, 71, 0.35)' }}>
              <div className="small" style={{ color: 'var(--warn)' }}>Unpaid Completed Revenue</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{money(unpaidCompletedRevenue)}</div>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
                Across {unpaidCompletedJobs.length} completed job{unpaidCompletedJobs.length === 1 ? '' : 's'} awaiting payment
              </div>
            </div>

            <div style={{ padding: 16, borderRadius: 10, background: 'var(--panel-soft)', border: '1px solid var(--border)' }}>
              <div className="small" style={{ color: 'var(--muted)' }}>Completed-Work Snapshot</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {money(estimatedCompletedProfit)} estimated completed profit at {pct(estimatedCompletedMargin)}
              </div>
              <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
                Uses all completed work value versus all completed-job tracked overhead.
              </div>
            </div>

            {navigateTo && (
              <button className="btn btn-accent" style={{ alignSelf: 'flex-start' }} onClick={() => navigateTo('jobs', 'outstanding')}>
                Review Outstanding Jobs
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 0 }}>
        <div className="card span-6" style={{ overflowX: 'auto' }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Profitability by Service Type</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Service</th>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Jobs</th>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Est. Margin</th>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Avg. Work Value</th>
              </tr>
            </thead>
            <tbody>
              {serviceTypeData.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>No completed services yet.</td>
                </tr>
              )}
              {serviceTypeData.map(row => (
                <tr key={row.serviceType} style={{ borderBottom: '1px solid var(--panel-soft)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{row.serviceType}</td>
                  <td style={{ padding: 8 }}>{row.jobCount}</td>
                  <td style={{ padding: 8, color: row.estimatedCompletedMargin < 0.3 ? 'var(--danger)' : 'var(--good)' }}>{pct(row.estimatedCompletedMargin)}</td>
                  <td style={{ padding: 8 }}>{money(row.averageWorkValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card span-6" style={{ overflowX: 'auto' }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Margin Warnings (Weakest Jobs)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Job #</th>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Work Value</th>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Overhead</th>
                <th style={{ padding: 8, color: 'var(--muted)' }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {weakestJobs.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>No completed jobs to analyze.</td>
                </tr>
              )}
              {weakestJobs.map((job, index) => (
                <tr key={`${String(job.id || '')}-${job.jobNumber || index}`} style={{ borderBottom: '1px solid var(--panel-soft)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>#{job.jobNumber || String(job.id || '').slice(0, 6) || 'Unknown'}</td>
                  <td style={{ padding: 8 }}>{money(getPayrollJobAmount(job))}</td>
                  <td style={{ padding: 8, color: 'var(--danger)' }}>{money(getBusinessGraphTrackedOverhead(job))}</td>
                  <td style={{ padding: 8, fontWeight: 700, color: getBusinessGraphJobMargin(job) < 0.3 ? 'var(--danger)' : 'var(--text)' }}>
                    {pct(getBusinessGraphJobMargin(job))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ background: 'var(--panel-soft)', borderStyle: 'dashed' }}>
        <h3 style={{ marginTop: 0, marginBottom: 8, color: 'var(--muted)' }}>Future Analytics Locked</h3>
        <p className="small" style={{ marginBottom: 16 }}>
          The following advanced financial graphs require a fully structured expense ledger to avoid fake accounting. They stay locked until the backend can support them accurately.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div style={{ padding: 12, background: 'var(--panel)', borderRadius: 6, opacity: 0.7 }}>
            <strong>Full Income vs Expenses</strong><br />
            <span className="small text-muted">Requires categorized expense records and dates.</span>
          </div>
          <div style={{ padding: 12, background: 'var(--panel)', borderRadius: 6, opacity: 0.7 }}>
            <strong>Waterfall Margin Breakdown</strong><br />
            <span className="small text-muted">Requires separate labor, material, tax, and overhead categories.</span>
          </div>
          <div style={{ padding: 12, background: 'var(--panel)', borderRadius: 6, opacity: 0.7 }}>
            <strong>Expense Treemap</strong><br />
            <span className="small text-muted">Requires nested vehicle, fuel, tools, and maintenance logs.</span>
          </div>
          <div style={{ padding: 12, background: 'var(--panel)', borderRadius: 6, opacity: 0.7 }}>
            <strong>Payroll Burden &amp; Tax</strong><br />
            <span className="small text-muted">Requires robust employee payroll and tax records.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ CUSTOMER ROUTES TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CustomerRoutesTab({ customers, serviceJobs, navigateTo }) {
  const todayKey = useMemo(() => toLocalISODate(), []);
  const customerById = useMemo(() => {
    const next = new Map();
    (customers || []).forEach(customer => next.set(String(customer.id), customer));
    return next;
  }, [customers]);

  const todaysStops = useMemo(() => {
    return [...(serviceJobs || [])]
      .filter(job => job && job.scheduledDate === todayKey && job.status !== 'Cancelled')
      .map(job => ({
        job,
        customer: customerById.get(String(job.customerId)) || null,
      }));
  }, [serviceJobs, todayKey, customerById]);

  const uniqueStopCount = useMemo(() => {
    return new Set(todaysStops.map(stop => String(stop.customer?.id || stop.job.id))).size;
  }, [todaysStops]);

  return (
    <div>
      <div className="grid" style={{ marginTop: 0 }}>
        <div className="card span-4">
          <div className="small" style={{ color: 'var(--muted)' }}>Route Date</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: '8px 0' }}>{todayKey}</div>
          <div className="small">Current route summaries are derived from scheduled jobs already in CRM.</div>
        </div>
        <div className="card span-4">
          <div className="small" style={{ color: 'var(--muted)' }}>Scheduled Stops</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: '8px 0' }}>{todaysStops.length}</div>
          <div className="small">Includes all jobs on today's route, even before future route heuristics exist.</div>
        </div>
        <div className="card span-4">
          <div className="small" style={{ color: 'var(--muted)' }}>Unique Customers</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: '8px 0' }}>{uniqueStopCount}</div>
          <div className="small">Use the map view for live geocoding and route drawing.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Today's Route Summary</h2>
            <div className="sub" style={{ marginTop: 4 }}>Existing scheduling data only. No same-hex recommendations are generated in this pass.</div>
          </div>
          <div className="flex-row">
            <button className="btn btn-accent" onClick={() => navigateTo('customers', 'map')}>Open Customer Map</button>
            <button className="btn btn-sm" onClick={() => navigateTo('scheduling', 'route_recommendations')}>Route Recommendations</button>
          </div>
        </div>
        {todaysStops.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '28px 20px', background: 'var(--panel-soft)', borderRadius: 10 }}>
            No jobs are scheduled for today, so there is no route summary to show yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {todaysStops.map((stop, index) => (
              <div key={stop.job.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--panel-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Stop {index + 1}: {stop.customer?.name || 'Unknown Customer'}</div>
                    <div className="small" style={{ marginTop: 4 }}>{stop.job.serviceType || 'Service pending'}</div>
                    <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>{stop.customer ? buildCustomerRouteAddress(stop.customer) : (stop.job.address || 'No address')}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                    <span className={`badge ${jobStatusClass(stop.job.status)}`}>{stop.job.status || 'Unknown'}</span>
                    <span className="small">{money(Number(stop.job.quotedAmount) || Number(stop.job.actualAmount) || 0)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TODO: Replace this placeholder when a backend route recommendation endpoint exists. */}
      <PlaceholderPanel
        eyebrow="Hexagon Routing Safety"
        title="Same-hex route recommendations are not implemented yet"
        description="The frontend must not duplicate the hexagon algorithm. When the backend endpoint exists, this view can consume same-hex suggestions, travel savings, and the $700 exception logic."
      />
    </div>
  );
}

// â”€â”€â”€ SCHEDULING TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SchedulingDispatchBoardTab({ customers, serviceJobs, navigateTo, calAuth }) {
  const queuedJobs = useMemo(() => {
    return [...(serviceJobs || [])]
      .filter(job => job.status === 'Scheduled' || job.status === 'In Progress')
      .sort((a, b) => String(a.scheduledDate || '').localeCompare(String(b.scheduledDate || '')));
  }, [serviceJobs]);

  const todaysCount = useMemo(() => {
    const todayKey = toLocalISODate();
    return queuedJobs.filter(job => job.scheduledDate === todayKey).length;
  }, [queuedJobs]);

  return (
    <div>
      <div className="grid" style={{ marginTop: 0 }}>
        <div className="card span-4">
          <div className="small" style={{ color: 'var(--muted)' }}>Dispatch Queue</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: '8px 0' }}>{queuedJobs.length}</div>
          <div className="small">Scheduled and in-progress jobs currently available to dispatch.</div>
        </div>
        <div className="card span-4">
          <div className="small" style={{ color: 'var(--muted)' }}>Today's Assignments</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: '8px 0' }}>{todaysCount}</div>
          <div className="small">Pulled directly from the current job list without creating a new scheduling data model.</div>
        </div>
        <div className="card span-4">
          <div className="small" style={{ color: 'var(--muted)' }}>Google Calendar</div>
          <div style={{ fontSize: 28, fontWeight: 800, margin: '8px 0' }}>{calAuth ? 'Connected' : 'Not linked'}</div>
          <div className="small">Manage connection status in Settings &gt; General. Use Calendar to review synced events.</div>
        </div>
      </div>

      <JobListSummaryTable
        title="Dispatch Board"
        description="A safe operational list of scheduled work using the existing job model."
        jobs={queuedJobs}
        customers={customers}
        emptyMessage="No jobs are queued for dispatch."
      />

      <div className="flex-row" style={{ marginTop: 18 }}>
        <button className="btn btn-accent" onClick={() => navigateTo('scheduling', 'calendar')}>Open Calendar</button>
        <button className="btn btn-sm" onClick={() => navigateTo('settings', 'general')}>Google Settings</button>
        <button className="btn btn-sm" onClick={() => navigateTo('jobs', 'active')}>Open Active Jobs</button>
      </div>
    </div>
  );
}

function SchedulingGoogleSyncTabLegacyUnused({ calAuth, navigateTo }) {
  return (
    <PlaceholderPanel
      eyebrow="Google Sync Safety"
      title="Google Calendar sync uses the existing calendar integration"
      description={calAuth
        ? 'Google Calendar is already connected. Keep auth and connect/disconnect flows in the existing Calendar view.'
        : 'Google Calendar is not connected. Use the existing Calendar view to connect it.'}
      actionLabel="Open Calendar"
      onAction={() => navigateTo('scheduling', 'calendar')}
      secondaryActionLabel="Dashboard Overview"
      onSecondaryAction={() => navigateTo('dashboard', 'overview')}
    >
      <div className="card" style={{ background: 'var(--panel-soft)', marginTop: 0 }}>
        <strong style={{ display: 'block', marginBottom: 8 }}>Current pass rule</strong>
        <div className="small">Do not create new Google auth state, OAuth routes, token handling, or API endpoints here. This subview is informational only.</div>
      </div>
    </PlaceholderPanel>
  );
}

function SchedulingRouteRecommendationsTab({ navigateTo }) {
  return (
    <div>
      {/* TODO: Replace this placeholder when the backend route recommendation endpoint exists and returns same-hex recommendations. */}
      <PlaceholderPanel
        eyebrow="Backend Dependency"
        title="Route recommendations need backend support"
        description="This view stays honest until the backend can return hexagon area matches, existing scheduled jobs, travel savings, and the $700 exception result."
        actionLabel="Open Customer Routes"
        onAction={() => navigateTo('customers', 'routes')}
        secondaryActionLabel="Open Calendar"
        onSecondaryAction={() => navigateTo('scheduling', 'calendar')}
      >
        <div className="grid" style={{ marginTop: 0 }}>
          <div className="card span-6" style={{ background: 'var(--panel-soft)' }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Expected backend output</strong>
            <div className="small">Hexagon match, existing scheduled customer/job, recommended date or open slot, estimated travel savings, and whether the over-$700 rule blocked a shared day.</div>
          </div>
          <div className="card span-6" style={{ background: 'var(--panel-soft)' }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Current pass safety</strong>
            <div className="small">Do not fake route recommendations. The frontend should wait for a real API contract before showing them.</div>
          </div>
        </div>
      </PlaceholderPanel>
    </div>
  );
}

// â”€â”€â”€ JOBS SUBVIEW TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function JobsOutstandingTab({ customers, serviceJobs }) {
  const outstandingJobs = useMemo(() => {
    return [...(serviceJobs || [])]
      .filter(isOutstandingJob)
      .sort((a, b) => String(a.scheduledDate || '').localeCompare(String(b.scheduledDate || '')));
  }, [serviceJobs]);

  return (
    <JobListSummaryTable
      title="Outstanding Jobs"
      description="Jobs that still need financial or operational resolution."
      jobs={outstandingJobs}
      customers={customers}
      emptyMessage="No outstanding jobs were found."
      reasonForJob={getOutstandingJobReason}
    />
  );
}

function JobsCompletedTab({ customers, serviceJobs }) {
  const completedJobs = useMemo(() => {
    return [...(serviceJobs || [])]
      .filter(job => job.status === 'Completed')
      .sort((a, b) => String(b.scheduledDate || '').localeCompare(String(a.scheduledDate || '')));
  }, [serviceJobs]);

  return (
    <JobListSummaryTable
      title="Completed Jobs"
      description="A completed-only view using the existing serviceJobs dataset."
      jobs={completedJobs}
      customers={customers}
      emptyMessage="No completed jobs are available yet."
    />
  );
}

// â”€â”€â”€ FINANCIALS SUBVIEW TABS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function FinancialsIncomeTab({ serviceJobs, navigateTo }) {
  const completedJobs = useMemo(() => (serviceJobs || []).filter(job => job.status === 'Completed'), [serviceJobs]);
  const paidCompletedJobs = useMemo(() => completedJobs.filter(isJobPaid), [completedJobs]);
  const unpaidCompletedJobs = useMemo(() => completedJobs.filter(job => !isJobPaid(job)), [completedJobs]);
  const totalRevenue = useMemo(() => paidCompletedJobs.reduce((sum, job) => sum + (Number(job.actualAmount) || 0), 0), [paidCompletedJobs]);
  const outstandingAr = useMemo(() => unpaidCompletedJobs.reduce((sum, job) => sum + getPayrollJobAmount(job), 0), [unpaidCompletedJobs]);
  const pendingEstimateValue = useMemo(() => {
    return (serviceJobs || [])
      .filter(job => job.status === 'Estimate')
      .reduce((sum, job) => sum + (Number(job.quotedAmount) || 0), 0);
  }, [serviceJobs]);
  const trackedOverhead = useMemo(() => completedJobs.reduce((sum, job) => sum + (Number(job.overheadSpent) || 0), 0), [completedJobs]);

  return (
    <div>
      <div className="grid" style={{ marginTop: 0 }}>
        <div className="card span-3">
          <div className="small" style={{ color: 'var(--muted)' }}>Realized Revenue</div>
          <div style={{ fontSize: 30, fontWeight: 800, margin: '8px 0' }}>{money(totalRevenue)}</div>
          <div className="small">Completed and paid jobs only.</div>
        </div>
        <div className="card span-3">
          <div className="small" style={{ color: 'var(--muted)' }}>Outstanding A/R</div>
          <div style={{ fontSize: 30, fontWeight: 800, margin: '8px 0', color: 'var(--danger)' }}>{money(outstandingAr)}</div>
          <div className="small">Completed jobs still awaiting collection.</div>
        </div>
        <div className="card span-3">
          <div className="small" style={{ color: 'var(--muted)' }}>Estimate Pipeline</div>
          <div style={{ fontSize: 30, fontWeight: 800, margin: '8px 0' }}>{money(pendingEstimateValue)}</div>
          <div className="small">Current estimate-stage value tracked in jobs.</div>
        </div>
        <div className="card span-3">
          <div className="small" style={{ color: 'var(--muted)' }}>Tracked Job Overhead</div>
          <div style={{ fontSize: 30, fontWeight: 800, margin: '8px 0' }}>{money(trackedOverhead)}</div>
          <div className="small">Existing overhead field only. Full expenses stay separate.</div>
        </div>
      </div>

      <PlaceholderPanel
        eyebrow="Income View"
        title="Income summaries stay real in this pass"
        description="This subview uses existing completed-job revenue, outstanding receivables, and estimate pipeline values without faking a broader accounting system."
        actionLabel="Open Dashboard Overview"
        onAction={() => navigateTo('dashboard', 'overview')}
        secondaryActionLabel="Open Payroll"
        onSecondaryAction={() => navigateTo('financials', 'payroll')}
      />
    </div>
  );
}

function FinancialsExpensesTab() {
  const defaultCategories = ['Gas', 'Food', 'Repair', 'Tools', 'Rentals', 'Payroll', 'Pressure Washing Tools', 'Other'];
  return (
    <div>
      {/* TODO: Replace this placeholder when a real expense storage/API exists. */}
      <PlaceholderPanel
        eyebrow="Expense Storage Pending"
        title="Expenses"
        description="The app architecture is ready for an expense ledger, but this pass does not fake persistence or rewrite payroll math."
      >
        <div className="grid" style={{ marginTop: 0 }}>
          <div className="card span-6" style={{ background: 'var(--panel-soft)' }}>
            <strong style={{ display: 'block', marginBottom: 10 }}>Required categories</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {defaultCategories.map(category => <span key={category} className="badge">{category}</span>)}
            </div>
          </div>
          <div className="card span-6" style={{ background: 'var(--panel-soft)' }}>
            <strong style={{ display: 'block', marginBottom: 10 }}>Planned filters</strong>
            <div className="small">All expenses, category totals, date range filters, and running totals will belong here once a backend data source exists.</div>
          </div>
        </div>
      </PlaceholderPanel>
    </div>
  );
}

function FinancialsExpenseAnalysisTab({ serviceJobs }) {
  const trackedOverhead = useMemo(() => {
    return (serviceJobs || []).reduce((sum, job) => sum + (Number(job.overheadSpent) || 0), 0);
  }, [serviceJobs]);

  return (
    <div>
      {/* TODO: Replace this placeholder when the backend expense ledger can drive real analysis. */}
      <PlaceholderPanel
        eyebrow="Analysis Placeholder"
        title="Expense Analysis"
        description="Expense analysis will eventually inform pricing, route profitability, owner reserve, and payroll impact. This pass only exposes the safe shell."
      >
        <div className="card" style={{ background: 'var(--panel-soft)', marginTop: 0 }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>Existing signal available now</strong>
          <div className="small">Tracked job overhead from current jobs: <span className="mono">{money(trackedOverhead)}</span></div>
        </div>
      </PlaceholderPanel>
    </div>
  );
}

function FinancialsReportsTab() {
  return (
    <PlaceholderPanel
      eyebrow="Reporting Placeholder"
      title="Reports"
      description="Reserve this subview for exports and financial reports once the data model is ready. Do not fake reporting output in this navigation refactor."
    />
  );
}

// â”€â”€â”€ SETTINGS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SettingsGeneralTabLegacyUnused() {
  return (
    <PlaceholderPanel
      eyebrow="Settings Placeholder"
      title="General Settings"
      description="This subview is intentionally minimal for now. It reserves a route location without changing existing business behavior."
    />
  );
}

function SettingsGeneralTab({
  calAuth,
  googleDisconnecting,
  disconnectGoogle,
  navigateTo,
  canUseGoogleAuth,
  canUseCalendar,
  travelRoutingSettings = DEFAULT_TRAVEL_ROUTING_SETTINGS,
  travelRoutingLoading = false,
  travelRoutingError = '',
  travelRoutingSaving = false,
  onSaveTravelRouting = async () => { },
  canManageTravelRouting = false,
}) {
  const [requestError, setRequestError] = useState('');
  const [travelDraft, setTravelDraft] = useState(() => normalizeTravelRoutingSettings(travelRoutingSettings));

  useEffect(() => {
    setTravelDraft(normalizeTravelRoutingSettings(travelRoutingSettings));
  }, [travelRoutingSettings]);

  const handleDisconnect = async () => {
    if (!disconnectGoogle) return;
    setRequestError('');
    try {
      await disconnectGoogle();
    } catch (err) {
      setRequestError(err?.message || 'Failed to disconnect Google Calendar.');
    }
  };
  const handleTravelRoutingSave = async () => {
    if (!onSaveTravelRouting || !canManageTravelRouting) return;
    await onSaveTravelRouting(travelDraft);
  };

  return (
    <div>
      <div className="title-row" style={{ marginBottom: 24 }}>
        <div>
          <div className="pill">Settings</div>
          <h2>General Settings</h2>
          <div className="sub">Manage shared CRM configuration and third-party connection ownership from one place.</div>
        </div>
      </div>

      {requestError && <div className="alert" style={{ marginBottom: 16 }}>{requestError}</div>}

      <div className="grid" style={{ marginTop: 0 }}>
        <div className="card span-8">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Google Calendar</div>
              <h3 style={{ marginTop: 8, marginBottom: 8 }}>Connection Management</h3>
              <div className="sub">
                Google Calendar authentication is managed here. Event viewing stays in Scheduling, and per-job calendar sync actions stay in Jobs.
              </div>
            </div>
            <div style={{ color: calAuth ? 'var(--good)' : 'var(--warn)', fontWeight: 700, fontSize: 14 }}>
              {calAuth ? 'Connected' : 'Not connected'}
            </div>
          </div>

          {!canUseGoogleAuth ? (
            <div style={{ padding: 14, borderRadius: 10, background: 'var(--panel-soft)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              This account does not have permission to manage Google Calendar authentication.
            </div>
          ) : (
            <>
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--panel-soft)', border: '1px solid var(--border)', marginBottom: 14 }}>
                <div className="small" style={{ color: 'var(--muted)' }}>Status</div>
                <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>
                  {calAuth ? 'Your CRM account is linked to Google Calendar.' : 'Your CRM account is not linked to Google Calendar yet.'}
                </div>
                <div className="small" style={{ marginTop: 8, color: 'var(--muted)' }}>
                  Use the existing backend OAuth flow. This page only centralizes where staff start and stop that connection.
                </div>
              </div>

              <div className="flex-row">
                {!calAuth && <a href="/api/auth/google/login" className="btn btn-accent">Connect Google Calendar</a>}
                {calAuth && (
                  <button className="btn btn-sm" onClick={handleDisconnect} disabled={googleDisconnecting}>
                    {googleDisconnecting ? 'Disconnecting...' : 'Disconnect Google Calendar'}
                  </button>
                )}
                {navigateTo && canUseCalendar && (
                  <button className="btn btn-sm" onClick={() => navigateTo('scheduling', 'calendar')}>Open Scheduling Calendar</button>
                )}
                {navigateTo && (
                  <button className="btn btn-sm" onClick={() => navigateTo('jobs', 'active')}>Open Active Jobs</button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="card span-4" style={{ background: 'var(--panel-soft)' }}>
          <strong style={{ display: 'block', marginBottom: 10 }}>Ownership Rule</strong>
          <div className="small" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            Keep Google auth and connection state management in Settings. Scheduling should focus on viewing calendar data, and Jobs should keep only job-specific sync actions.
          </div>
        </div>

        <div className="card span-8">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div className="small" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Travel Routing Defaults</div>
              <h3 style={{ marginTop: 8, marginBottom: 8 }}>Estimate Builder Mileage Route</h3>
              <div className="sub">
                The Estimate Builder routes Home -&gt; Worker pickup -&gt; Customer, then doubles the one-way road mileage for round trip travel in Price Analysis.
              </div>
            </div>
            <div style={{ color: canManageTravelRouting ? 'var(--accent)' : 'var(--muted)', fontWeight: 700, fontSize: 14 }}>
              {canManageTravelRouting ? 'Admin editable' : 'Read only'}
            </div>
          </div>

          {travelRoutingError && <div className="alert" style={{ marginBottom: 14 }}>{travelRoutingError}</div>}

          <div className="modal-field">
            <label htmlFor="settings-home-base-address">Home Base Address</label>
            <input
              id="settings-home-base-address"
              type="text"
              value={travelDraft.homeBaseAddress}
              onChange={event => setTravelDraft(prev => ({ ...prev, homeBaseAddress: event.target.value }))}
              readOnly={!canManageTravelRouting || travelRoutingLoading}
              style={{ padding: '10px', background: canManageTravelRouting ? 'var(--panel-soft)' : 'var(--panel)', color: 'var(--text)' }}
            />
          </div>

          <div className="modal-field" style={{ marginBottom: 0 }}>
            <label htmlFor="settings-worker-pickup-address">Worker Pickup Address</label>
            <input
              id="settings-worker-pickup-address"
              type="text"
              value={travelDraft.workerPickupAddress}
              onChange={event => setTravelDraft(prev => ({ ...prev, workerPickupAddress: event.target.value }))}
              readOnly={!canManageTravelRouting || travelRoutingLoading}
              style={{ padding: '10px', background: canManageTravelRouting ? 'var(--panel-soft)' : 'var(--panel)', color: 'var(--text)' }}
            />
          </div>

          <div className="small" style={{ marginTop: 10, color: 'var(--muted)' }}>
            {travelRoutingLoading
              ? 'Loading saved routing defaults...'
              : 'These defaults feed the Estimate Builder auto-route and the shared Price Analysis round trip miles field.'}
          </div>

          {canManageTravelRouting && (
            <div className="flex-row" style={{ marginTop: 16 }}>
              <button className="btn btn-accent" onClick={handleTravelRoutingSave} disabled={travelRoutingLoading || travelRoutingSaving}>
                {travelRoutingSaving ? 'Saving...' : 'Save Travel Routing Defaults'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setTravelDraft(normalizeTravelRoutingSettings(travelRoutingSettings))}
                disabled={travelRoutingLoading || travelRoutingSaving}
              >
                Revert
              </button>
            </div>
          )}
        </div>

        <div className="card span-4" style={{ background: 'var(--panel-soft)' }}>
          <strong style={{ display: 'block', marginBottom: 10 }}>Route Logic</strong>
          <div className="small" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            Road mileage comes from geocoding each stop and routing them in order. Price Analysis still lets you override the miles manually if a customer address cannot be routed.
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ WRAPPER COMPONENTS (TABS CONSOLIDATION) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CombinedEstimatesTab owns its own sub-tab state. The {...props} spread is
// intentional: EstimatesTab, IntakeImportsTab, and ReceiptTab each pull the
// props they need by name â€” no component receives anything it doesn't use.
function CombinedEstimatesTab(props) {
  const [subTab, setSubTab] = useState('builder');
  return (
    <div>
      <div className="top-nav" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <button className={`nav-tab ${subTab === 'builder' ? 'active' : ''}`} onClick={() => setSubTab('builder')}>Estimate Builder</button>
        <button className={`nav-tab ${subTab === 'intake_queue' ? 'active' : ''}`} onClick={() => setSubTab('intake_queue')}>Website Intake Queue</button>
      </div>
      {subTab === 'builder' && <EstimatesTab {...props} onProfitSnapshotChange={props.onProfitSnapshotChange} />}
      {subTab === 'intake_queue' && <IntakeImportsTab {...props} />}
    </div>
  );
}

// CombinedJobsTab uses a useEffect to jump to 'recurring' when the parent
// signals via customerJobsRequest. This is a deliberate cross-hierarchy signal
// pattern â€” do not convert it to derived state or remove the effect.
function CombinedJobsTab(props) {
  const [subTab, setSubTab] = useState(props.customerJobsRequest ? 'recurring' : 'active');
  useEffect(() => {
    if (props.customerJobsRequest) setSubTab('recurring');
  }, [props.customerJobsRequest]);
  return (
    <div>
      <div className="top-nav" style={{ marginBottom: 16 }}>
        <button className={`nav-tab ${subTab === 'active' ? 'active' : ''}`} onClick={() => setSubTab('active')}>Active & Scheduled Jobs</button>
        <button className={`nav-tab ${subTab === 'recurring' ? 'active' : ''}`} onClick={() => setSubTab('recurring')}>Recurring Frequencies</button>
      </div>
      {subTab === 'active' && <JobsTab {...props} />}
      {subTab === 'recurring' && <CustomerJobsTab {...props} />}
    </div>
  );
}

// FinancialsTab sub-tab state resets to 'overview' on every main-tab switch
// because this component unmounts/remounts â€” that is expected behaviour.
function FinancialsTab(props) {
  const [subTab, setSubTab] = useState('overview');
  return (
    <div>
      <div className="top-nav" style={{ marginBottom: 16 }}>
        <button className={`nav-tab ${subTab === 'overview' ? 'active' : ''}`} onClick={() => setSubTab('overview')}>Income & Dashboard</button>
        <button className={`nav-tab ${subTab === 'payroll' ? 'active' : ''}`} onClick={() => setSubTab('payroll')}>Payroll & Expenses</button>
      </div>
      {subTab === 'overview' && <DashboardTab {...props} />}
      {subTab === 'payroll' && <PayrollTabEnhanced {...props} />}
    </div>
  );
}

// â”€â”€â”€ MAIN APP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function App() {
  const [route, setRoute] = useState(() => resolveRoute('dashboard', 'overview'));
  const [activeStaticPage, setActiveStaticPage] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [bootKey, setBootKey] = useState(0);
  const [deleteRequest, setDeleteRequest] = useState(null); // { recordType, recordId, recordLabel }
  const [recurringJobsRefreshSignal, setRecurringJobsRefreshSignal] = useState(0);

  // Seed mock data so the app looks good before (or without) a backend
  const MOCK_CUSTOMERS = [{ id: 1, name: "Demo Customer", address: "100 Demo Way", cityStateZip: "Demo City, ST 00000", phone: "555-010-0001", email: "demo-customer@example.invalid", status: "Active", notes: "", customerNumber: 1 }];
  const MOCK_EMPLOYEES = [defaultEmployee("labor", 0, { name: "Demo Owner" }), defaultEmployee("admin", 0, { name: "Demo Admin" })];
  const MOCK_JOBS = [{ id: 'j1', jobNumber: 1001, customerId: 1, serviceType: "Interior Window Cleaning", status: "Completed", paymentStatus: "Paid", invoiceSent: true, actualAmount: 450, quotedAmount: 450, overheadSpent: 40, scheduledDate: toLocalISODate(), assignedEmployeeIds: [MOCK_EMPLOYEES[0].id, MOCK_EMPLOYEES[1].id] }];

  const [customers, setCustomers] = useState(MOCK_CUSTOMERS);
  const [employees, setEmployees] = useState(MOCK_EMPLOYEES);
  const [serviceJobs, setServiceJobs] = useState(MOCK_JOBS.map(withJobFinancialDefaults));
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [customerEditRequest, setCustomerEditRequest] = useState(null);
  const [customerJobsRequest, setCustomerJobsRequest] = useState(null);
  const [calAuth, setCalAuth] = useState(false);
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);
  const [travelRoutingSettings, setTravelRoutingSettings] = useState(() => normalizeTravelRoutingSettings(DEFAULT_TRAVEL_ROUTING_SETTINGS));
  const [travelRoutingLoading, setTravelRoutingLoading] = useState(true);
  const [travelRoutingLoadError, setTravelRoutingLoadError] = useState('');
  const [travelRoutingSaveError, setTravelRoutingSaveError] = useState('');
  const [travelRoutingSaving, setTravelRoutingSaving] = useState(false);
  const [mapFocus, setMapFocus] = useState(null);
  const [appNotice, setAppNotice] = useState('');
  const [estimateBuilderSnapshot, setEstimateBuilderSnapshot] = useState(DEFAULT_ESTIMATE_BUILDER_SNAPSHOT);

  // â”€â”€ Permission helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Returns true if currentUser is null (no auth backend yet) or is admin,
  // or if the explicit permission flag is truthy.
  const canDo = useCallback(perm => {
    if (!currentUser) return true;
    if (currentUser.role === 'admin') return true;
    return Boolean(currentUser?.permissions?.[perm]);
  }, [currentUser]);

  const navigateTo = useCallback((moduleId, subviewId) => {
    setActiveStaticPage(null);
    setRoute(resolveRoute(moduleId, subviewId));
  }, []);

  const navigateLegacyTab = useCallback(tabId => {
    const normalized = String(tabId || '').trim().toLowerCase();
    if (normalized === 'privacy') {
      setActiveStaticPage('privacy');
      return;
    }
    if (normalized === 'terms') {
      setActiveStaticPage('terms');
      return;
    }
    const resolved = legacyRoutes[normalized];
    if (resolved) {
      navigateTo(resolved[0], resolved[1]);
      return;
    }
    navigateTo('dashboard', 'overview');
  }, [navigateTo]);

  const setActiveTab = useCallback(tabId => {
    navigateLegacyTab(tabId);
  }, [navigateLegacyTab]);

  const isModuleVisible = useCallback(moduleId => {
    if (moduleId === 'estimates' || moduleId === 'jobs') return canDo('canViewJobs');
    if (moduleId === 'customers') return canDo('canViewCustomers');
    return true;
  }, [canDo]);

  // â”€â”€ Primary boot: /api/auth/me first â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuthLoading(true);
      setTravelRoutingLoading(true);
      setTravelRoutingLoadError('');
      setTravelRoutingSaveError('');
      let me = null;
      try {
        me = await apiFetch('/api/auth/me', undefined, { silent: true });
      } catch { /* auth/me not available - proceed as pre-auth degraded mode */ }

      if (cancelled) return;

      // Flatten: backend returns { authenticated, user:{...}, permissions:{...}, mustChangePassword }
      // Merge into one object so the rest of the app can do currentUser.role, currentUser.permissions, etc.
      const flatUser = (me && me.authenticated && me.user)
        ? { ...me.user, permissions: me.permissions || {}, mustChangePassword: Boolean(me.mustChangePassword) }
        : null;
      setCurrentUser(flatUser);

      // If password change required, stop here â€” no other fetches
      if (me?.mustChangePassword) {
        setAuthLoading(false);
        setIsInitialLoading(false);
        setTravelRoutingLoading(false);
        return;
      }

      // CSRF token
      await apiFetch('/api/csrf-token', undefined, { silent: true })
        .then(d => { if (d?.token) _csrfToken = d.token; })
        .catch(() => { });

      // Fetch only datasets the user is permitted to see
      // Backend permission flags are camelCase with "can" prefix: canViewCustomers, canViewJobs, etc.
      const perms = me?.permissions || {};
      const isAdminRole = !me || me?.user?.role === 'admin';
      const wantCustomers = isAdminRole || Boolean(perms.canViewCustomers);
      const wantJobs = isAdminRole || Boolean(perms.canViewJobs);
      // Admins use /api/v1/employees (full records, requires canManageEmployees).
      // Employees use /api/v1/employees/directory (names only, requires canViewEmployeeDirectory).
      const wantEmployeeFull = isAdminRole || Boolean(perms.canManageEmployees);
      const wantEmployeeDir = !wantEmployeeFull && Boolean(perms.canViewEmployeeDirectory);

      try {
        const [c, j, e, travelRouting] = await Promise.all([
          wantCustomers ? apiFetch('/api/v1/customers').catch(() => null) : Promise.resolve(null),
          wantJobs ? apiFetch('/api/v1/jobs').catch(() => null) : Promise.resolve(null),
          wantEmployeeFull ? apiFetch('/api/v1/employees').catch(() => null) :
            wantEmployeeDir ? apiFetch('/api/v1/employees/directory').catch(() => null) : Promise.resolve(null),
          apiFetch('/api/v1/settings/travel-routing')
            .then(data => ({ ok: true, data }))
            .catch(error => ({ ok: false, error })),
        ]);
        if (cancelled) return;
        if (Array.isArray(c) && c.length > 0) setCustomers(c);
        if (Array.isArray(j)) setServiceJobs(j.map(withJobFinancialDefaults));
        if (Array.isArray(e) && e.length > 0) setEmployees(e);
        if (travelRouting?.ok) {
          setTravelRoutingSettings(normalizeTravelRoutingSettings(travelRouting.data));
          setTravelRoutingLoadError('');
        } else {
          setTravelRoutingLoadError(travelRouting?.error?.message || 'Failed to load travel routing defaults.');
        }
        setTravelRoutingLoading(false);
      } catch {
        if (!cancelled) {
          setTravelRoutingLoadError('Failed to load travel routing defaults.');
          setTravelRoutingLoading(false);
        }
      }

      // Calendar auth status
      apiFetch('/api/auth/google/status', undefined, { silent: true })
        .then(d => { if (!cancelled) setCalAuth(d?.linked === true); })
        .catch(() => { if (!cancelled) setCalAuth(false); });

      if (!cancelled) {
        setAuthLoading(false);
        setIsInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bootKey]);

  useEffect(() => {
    if (!appNotice) return;
    const timeoutId = window.setTimeout(() => setAppNotice(''), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [appNotice]);

  useEffect(() => {
    if (customerJobsRequest && route.module === 'jobs' && route.subview === 'active') {
      setRoute(resolveRoute('jobs', 'recurring'));
    }
  }, [customerJobsRequest, route.module, route.subview]);

  // Reload all permissioned data â€” called after admin executes a delete via messenger
  const reloadPermittedData = useCallback(async () => {
    try {
      const [c, j] = await Promise.all([
        canDo('canViewCustomers') ? apiFetch('/api/v1/customers').catch(() => null) : Promise.resolve(null),
        canDo('canViewJobs') ? apiFetch('/api/v1/jobs').catch(() => null) : Promise.resolve(null),
      ]);
      if (Array.isArray(c) && c.length > 0) setCustomers(c);
      if (Array.isArray(j)) setServiceJobs(j.map(withJobFinancialDefaults));
    } catch { }
    // Bump signal so CustomerJobsTab re-fetches if it's open with a selected customer
    setRecurringJobsRefreshSignal(s => s + 1);
  }, [canDo]);

  const disconnectGoogle = async () => {
    setGoogleDisconnecting(true);
    try {
      await apiFetch('/api/auth/google/disconnect', { method: 'DELETE' });
      setCalAuth(false);
    } finally {
      setGoogleDisconnecting(false);
    }
  };

  const handleLogout = () => { window.location.href = '/login'; };

  const openDeleteRequest = useCallback((recordType, recordId, recordLabel) => {
    setDeleteRequest({ recordType, recordId, recordLabel });
  }, []);

  const handleDeleteRequested = useCallback(thread => {
    setDeleteRequest(null);
    setAppNotice(`Deletion request submitted. View it in Admin Messenger.`);
  }, []);

  const handleCustomerJobAction = (action, payload) => {
    const serviceName = payload?.service_label ? `: ${payload.service_label}` : '';
    if (action === 'created') setAppNotice(`Recurring job created${serviceName}`);
    else if (action === 'bulkCreated') setAppNotice(`${payload?.count || 0} recurring jobs created${payload?.customerName ? ` for ${payload.customerName}` : ''}`);
    else if (action === 'updated') setAppNotice(`Recurring job updated${serviceName}`);
    else if (action === 'deleted') setAppNotice('Recurring job deleted');
    else if (action === 'occurrencePushed') setAppNotice(`Occurrence pushed${serviceName}`);
    else if (action === 'invoicePrepared') setAppNotice(`Recurring invoice prepared${serviceName}`);
    else setAppNotice('Recurring job saved');
  };

  const handleIntakeAction = (action, payload) => {
    const leadName = payload?.leadSummary?.name || payload?.customer?.name || payload?.intakeImport?.leadSummary?.name || 'lead';
    if (action === 'linked') setAppNotice(`Intake linked to existing customer: ${leadName}`);
    else if (action === 'created') setAppNotice(`New lead created from website intake: ${leadName}`);
    else if (action === 'alreadyConverted') setAppNotice(`This intake was already converted: ${leadName}`);
    else if (action === 'reviewed') setAppNotice(`Intake marked reviewed: ${leadName}`);
    else if (action === 'manualImported') setAppNotice(`Manual intake imported${leadName !== 'lead' ? ': ' + leadName : ''}.`);
    else setAppNotice('Intake updated');
  };
  const canManageTravelRouting = currentUser?.role === 'admin';
  const saveTravelRoutingSettings = useCallback(async nextSettings => {
    const payload = normalizeTravelRoutingSettings(nextSettings);
    setTravelRoutingSaving(true);
    setTravelRoutingSaveError('');
    try {
      const saved = await apiFetch('/api/v1/settings/travel-routing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const normalized = normalizeTravelRoutingSettings(saved);
      setTravelRoutingSettings(normalized);
      setTravelRoutingLoadError('');
      setAppNotice('Travel routing defaults saved.');
      return normalized;
    } catch (err) {
      const message = err?.message || 'Failed to save travel routing defaults.';
      setTravelRoutingSaveError(message);
      throw err;
    } finally {
      setTravelRoutingSaving(false);
    }
  }, []);

  const activeModule = route.module;
  const activeSubview = route.subview;
  const canUseGoogleAuth = canDo('canUseGoogleAuth');
  const canUseCalendar = canDo('canUseCalendar');
  const visibleModules = MODULES.filter(module => isModuleVisible(module.id));
  const visibleSubviews = getModuleSubviews(activeModule);

  const renderSubview = () => {
    if (activeStaticPage === 'privacy') return <PrivacyPolicy />;
    if (activeStaticPage === 'terms') return <TermsOfService />;

    switch (activeModule) {
      case 'dashboard':
        switch (activeSubview) {
          case 'price_analysis':
            return <ProfitAnalysisTab customers={customers} setCustomers={setCustomers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} apiFetch={apiFetch} setActiveTab={setActiveTab} setCustomerEditRequest={setCustomerEditRequest} onIntakeAction={handleIntakeAction} estimateBuilderSnapshot={estimateBuilderSnapshot} />;
          case 'price_config':
            return <PricingEditorTab />;
          case 'business_graphs':
            return <BusinessGraphsTab customers={customers} serviceJobs={serviceJobs} navigateTo={navigateTo} />;
          case 'overview':
          default:
            return <DashboardTab customers={customers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} employees={employees} setEmployees={setEmployees} setActiveTab={setActiveTab} navigateTo={navigateTo} calAuth={calAuth} />;
        }

      case 'estimates':
        switch (activeSubview) {
          case 'intake_queue':
            return <IntakeImportsTab customers={customers} setCustomers={setCustomers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} apiFetch={apiFetch} setActiveTab={setActiveTab} setCustomerEditRequest={setCustomerEditRequest} onIntakeAction={handleIntakeAction} />;
          case 'builder':
          default:
            return <EstimatesTab customers={customers} setCustomers={setCustomers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} apiFetch={apiFetch} setActiveTab={setActiveTab} setCustomerEditRequest={setCustomerEditRequest} onIntakeAction={handleIntakeAction} onProfitSnapshotChange={setEstimateBuilderSnapshot} travelRoutingSettings={travelRoutingSettings} travelRoutingLoading={travelRoutingLoading} travelRoutingError={travelRoutingLoadError} />;
        }

      case 'customers':
        switch (activeSubview) {
          case 'map':
            return <MapTab customers={customers} setCustomers={setCustomers} serviceJobs={serviceJobs} mapFocus={mapFocus} setMapFocus={setMapFocus} openCustomerEditor={c => { setCustomerEditRequest(c?.id || null); setActiveTab('database'); }} />;
          case 'routes':
            return <CustomerRoutesTab customers={customers} serviceJobs={serviceJobs} navigateTo={navigateTo} />;
          case 'job_receipts':
            return <ReceiptTab customers={customers} setCustomers={setCustomers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} apiFetch={apiFetch} setActiveTab={setActiveTab} setCustomerEditRequest={setCustomerEditRequest} onIntakeAction={handleIntakeAction} />;
          case 'directory':
          default:
            return <CustomersTab customers={customers} setCustomers={setCustomers} isInitialLoading={isInitialLoading} setActiveTab={setActiveTab} setMapFocus={setMapFocus} customerEditRequest={customerEditRequest} setCustomerEditRequest={setCustomerEditRequest} setCustomerJobsRequest={setCustomerJobsRequest} canExecuteDelete={canDo('canExecuteDelete')} onRequestDelete={openDeleteRequest} />;
        }

      case 'scheduling':
        switch (activeSubview) {
          case 'dispatch_board':
            return <SchedulingDispatchBoardTab customers={customers} serviceJobs={serviceJobs} navigateTo={navigateTo} calAuth={calAuth} />;
          case 'route_recommendations':
            return <SchedulingRouteRecommendationsTab navigateTo={navigateTo} />;
          case 'calendar':
          default:
            return <CalendarTabLegacyUnused calAuth={calAuth} navigateTo={navigateTo} customers={customers} serviceJobs={serviceJobs} />;
        }

      case 'jobs':
        switch (activeSubview) {
          case 'outstanding':
            return <JobsOutstandingTab customers={customers} serviceJobs={serviceJobs} />;
          case 'recurring':
            return <CustomerJobsTab serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} customers={customers} employees={employees} calAuth={calAuth} canExecuteDelete={canDo('canExecuteDelete')} onRequestDelete={openDeleteRequest} apiFetch={apiFetch} onJobAction={handleCustomerJobAction} customerJobsRequest={customerJobsRequest} setCustomerJobsRequest={setCustomerJobsRequest} refreshSignal={recurringJobsRefreshSignal} />;
          case 'completed':
            return <JobsCompletedTab customers={customers} serviceJobs={serviceJobs} />;
          case 'active':
          default:
            return <JobsTab serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} customers={customers} employees={employees} calAuth={calAuth} canExecuteDelete={canDo('canExecuteDelete')} onRequestDelete={openDeleteRequest} apiFetch={apiFetch} onJobAction={handleCustomerJobAction} customerJobsRequest={customerJobsRequest} setCustomerJobsRequest={setCustomerJobsRequest} refreshSignal={recurringJobsRefreshSignal} />;
        }

      case 'financials':
        switch (activeSubview) {
          case 'expenses':
            return <FinancialsExpensesTab />;
          case 'expense_analysis':
            return <FinancialsExpenseAnalysisTab serviceJobs={serviceJobs} />;
          case 'payroll':
            return <PayrollTabEnhanced customers={customers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} employees={employees} setEmployees={setEmployees} setActiveTab={setActiveTab} />;
          case 'reports':
            return <FinancialsReportsTab />;
          case 'income':
          default:
            return <FinancialsIncomeTab customers={customers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} employees={employees} setEmployees={setEmployees} setActiveTab={setActiveTab} navigateTo={navigateTo} />;
        }

      case 'settings':
        return <SettingsGeneralTab calAuth={calAuth} googleDisconnecting={googleDisconnecting} disconnectGoogle={disconnectGoogle} navigateTo={navigateTo} canUseGoogleAuth={canUseGoogleAuth} canUseCalendar={canUseCalendar} travelRoutingSettings={travelRoutingSettings} travelRoutingLoading={travelRoutingLoading} travelRoutingError={travelRoutingSaveError || travelRoutingLoadError} travelRoutingSaving={travelRoutingSaving} onSaveTravelRouting={saveTravelRoutingSettings} canManageTravelRouting={canManageTravelRouting} />;

      default:
        return <DashboardTab customers={customers} serviceJobs={serviceJobs} setServiceJobs={setServiceJobs} employees={employees} setEmployees={setEmployees} setActiveTab={setActiveTab} navigateTo={navigateTo} calAuth={calAuth} />;
    }
  };

  // â”€â”€ Blocking screens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--muted)', fontSize: 16 }}>
        Loadingâ€¦
      </div>
    );
  }

  if (currentUser?.mustChangePassword) {
    return <ChangePasswordScreen onSuccess={() => {
      setCurrentUser(null);
      setAuthLoading(true);
      setBootKey(k => k + 1);
    }} />;
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span style={{ color: 'var(--accent)' }}>FieldOps Demo</span> CRM
          </div>

          {currentUser && (
            <div className="sidebar-user">
              <div style={{ fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentUser.displayName || currentUser.username || 'User'}
                {currentUser.role && <span style={{ marginLeft: 6, color: 'var(--accent)', fontWeight: 600, textTransform: 'capitalize' }}>Â· {currentUser.role}</span>}
              </div>
              <button onClick={handleLogout} className="btn btn-sm" style={{ fontSize: 11, marginTop: 6 }}>Log out</button>
            </div>
          )}

          <nav className="sidebar-nav" aria-label="Primary CRM modules">
            {visibleModules.map(module => (
              <button
                key={module.id}
                className={`sidebar-item ${activeModule === module.id && !activeStaticPage ? 'active' : ''}`}
                onClick={() => navigateTo(module.id)}
              >
                {module.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="workspace">
          {!activeStaticPage && (
            <header className="dynamic-topbar" aria-label="Subview navigation">
              {visibleSubviews.map(subview => (
                <button
                  key={subview.id}
                  className={`topbar-item ${activeSubview === subview.id ? 'active' : ''}`}
                  onClick={() => navigateTo(activeModule, subview.id)}
                >
                  {subview.label}
                </button>
              ))}
            </header>
          )}

          <main className="main-content">
            {false && !calAuth && canDo('canUseCalendar') && (
              <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--warn)' }}>
                âš  Google Calendar not connected â€”{' '}
                <a href="/api/auth/google/login" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>authorize here</a>
                {' '}to enable calendar sync.
              </div>
            )}

            {appNotice && <div className="alert" style={{ marginBottom: 16 }}>{appNotice}</div>}

            {renderSubview()}
          </main>
        </div>
      </div>

      <footer className="site-footer">
        <div className="footer-links">
          <a href="/privacy" onClick={e => { e.preventDefault(); setActiveTab('privacy'); }}>Privacy Policy</a>
          <a href="/terms" onClick={e => { e.preventDefault(); setActiveTab('terms'); }}>Terms of Service</a>
        </div>
        <div>&copy; {new Date().getFullYear()} FieldOps Demo CRM. All rights reserved.</div>
      </footer>

      {deleteRequest && (
        <RequestDeleteModal
          recordType={deleteRequest.recordType}
          recordId={deleteRequest.recordId}
          recordLabel={deleteRequest.recordLabel}
          onClose={() => setDeleteRequest(null)}
          onRequested={handleDeleteRequested}
        />
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
