/**
 * Centralized tooltip manager that handles translation, positioning, and ARIA wiring.
 *
 * Usage:
 *   const tooltips = createTooltipService({ translate });
 *   tooltips.registerStaticTooltips();
 *   tooltips.setTooltip(buttonEl, 'viewer.buttons.capture', 'Capture');
 */
export function createTooltipService({
  translate,
  documentRef = document,
  windowRef = window,
} = {}) {
  if (typeof translate !== 'function') {
    throw new Error('createTooltipService requires a translate(key, fallback) function');
  }

  const hosts = new Map();
  const tooltipEl = documentRef.createElement('div');
  tooltipEl.className = 'app-tooltip';
  tooltipEl.id = 'appTooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  tooltipEl.setAttribute('aria-hidden', 'true');
  documentRef.body.appendChild(tooltipEl);

  let activeHost = null;

  const resolveText = (host) => {
    const metadata = hosts.get(host) || {};
    const key = host.getAttribute('data-tooltip-key') || metadata.key || '';
    const fallback =
      host.getAttribute('data-tooltip-default') ??
      metadata.fallback ??
      host.getAttribute('aria-label') ??
      '';
    if (!key && !fallback) {
      return '';
    }
    return translate(key, fallback || '');
  };

  const applyTooltipText = (host) => {
    const text = resolveText(host);
    if (text) {
      host.setAttribute('data-tooltip', text);
    } else {
      host.removeAttribute('data-tooltip');
    }
    if (activeHost === host && tooltipEl) {
      tooltipEl.textContent = text;
    }
  };

  const registerHost = (host, { key, fallback } = {}) => {
    if (!host) return;
    const current = hosts.get(host) || {};
    const nextKey = key || host.getAttribute('data-tooltip-key') || current.key || '';
    const nextFallback =
      fallback ??
      host.getAttribute('data-tooltip-default') ??
      current.fallback ??
      host.getAttribute('aria-label') ??
      '';

    if (!nextKey && !nextFallback) {
      return;
    }

    hosts.set(host, { key: nextKey, fallback: nextFallback });
    if (nextKey) {
      host.setAttribute('data-tooltip-key', nextKey);
    }
    if (nextFallback) {
      host.setAttribute('data-tooltip-default', nextFallback);
    } else {
      host.removeAttribute('data-tooltip-default');
    }
    host.setAttribute('data-tooltip-managed', 'true');
    applyTooltipText(host);
  };

  const registerStaticTooltips = (root = documentRef) => {
    if (!root?.querySelectorAll) {
      return;
    }
    const elements = root.querySelectorAll('[data-tooltip-key], [data-i18n-attr*="data-tooltip:"]');
    elements.forEach((el) => registerHost(el));
  };

  const positionTooltip = (host) => {
    if (!host || !tooltipEl) {
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const offset = 10;
    const top = Math.max(4, hostRect.top - tooltipRect.height - offset);
    const viewportWidth = windowRef.innerWidth || documentRef.documentElement.clientWidth || 0;
    const padding = 8;
    const hostCenter = hostRect.left + hostRect.width / 2;
    const halfTooltip = tooltipRect.width / 2;
    const clampedCenter = Math.min(
      viewportWidth - padding - halfTooltip,
      Math.max(padding + halfTooltip, hostCenter)
    );
    const arrowOffset = hostCenter - clampedCenter;

    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${clampedCenter}px`;
    tooltipEl.style.setProperty('--arrow-offset', `${arrowOffset}px`);
  };

  const showTooltip = (host) => {
    if (!host || !hosts.has(host)) {
      return;
    }
    applyTooltipText(host);
    const text = host.getAttribute('data-tooltip');
    if (!text) {
      return;
    }
    tooltipEl.textContent = text;
    positionTooltip(host);
    tooltipEl.dataset.visible = 'true';
    tooltipEl.setAttribute('aria-hidden', 'false');
    host.setAttribute('aria-describedby', tooltipEl.id);
    activeHost = host;
  };

  const hideTooltip = (host) => {
    if (host && host !== activeHost) {
      return;
    }
    if (activeHost) {
      activeHost.removeAttribute('aria-describedby');
    }
    tooltipEl.dataset.visible = 'false';
    tooltipEl.setAttribute('aria-hidden', 'true');
    activeHost = null;
  };

  const getRegisteredHost = (target) => {
    if (!target) return null;
    const candidate = target.closest?.('[data-tooltip-key]');
    if (candidate && hosts.has(candidate)) {
      return candidate;
    }
    return null;
  };

  const handlePointerOver = (event) => {
    const host = getRegisteredHost(event.target);
    if (host) {
      showTooltip(host);
    }
  };

  const handlePointerOut = (event) => {
    const host = getRegisteredHost(event.target);
    if (host && (!event.relatedTarget || !host.contains(event.relatedTarget))) {
      hideTooltip(host);
    }
  };

  const handleFocusIn = (event) => {
    const host = getRegisteredHost(event.target);
    if (host) {
      showTooltip(host);
    }
  };

  const handleFocusOut = (event) => {
    const host = getRegisteredHost(event.target);
    if (host) {
      hideTooltip(host);
    }
  };

  const handleScroll = () => {
    if (activeHost) {
      hideTooltip(activeHost);
    }
  };

  const handleResize = () => {
    if (activeHost) {
      positionTooltip(activeHost);
    }
  };

  documentRef.addEventListener('pointerover', handlePointerOver);
  documentRef.addEventListener('pointerout', handlePointerOut);
  documentRef.addEventListener('focusin', handleFocusIn);
  documentRef.addEventListener('focusout', handleFocusOut);
  windowRef.addEventListener('scroll', handleScroll, { passive: true });
  windowRef.addEventListener('resize', handleResize);

  const refresh = () => {
    hosts.forEach((_, host) => applyTooltipText(host));
    if (activeHost) {
      showTooltip(activeHost);
    }
  };

  const destroy = () => {
    documentRef.removeEventListener('pointerover', handlePointerOver);
    documentRef.removeEventListener('pointerout', handlePointerOut);
    documentRef.removeEventListener('focusin', handleFocusIn);
    documentRef.removeEventListener('focusout', handleFocusOut);
    windowRef.removeEventListener('scroll', handleScroll);
    windowRef.removeEventListener('resize', handleResize);
    if (tooltipEl?.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
    }
    hosts.clear();
    activeHost = null;
  };

  return {
    registerStaticTooltips,
    registerHost,
    setTooltip: registerHost,
    refresh,
    showTooltip,
    hideTooltip,
    destroy,
  };
}
