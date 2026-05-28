(function () {
  function initNavBar(navBar) {
    if (!navBar) return;

    var toggle = navBar.querySelector('.nav-toggle');
    var nav = navBar.querySelector('.nav');
    if (!toggle || !nav) return;

    var mobileQuery = window.matchMedia('(max-width: 768px)');

    function setOpen(open) {
      var isOpen = !!open && mobileQuery.matches;
      navBar.classList.toggle('is-open', isOpen);
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    toggle.addEventListener('click', function () {
      setOpen(!navBar.classList.contains('is-open'));
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        setOpen(false);
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    });

    document.addEventListener('click', function (event) {
      if (!mobileQuery.matches) return;
      if (navBar.contains(event.target)) return;
      setOpen(false);
    });

    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', function () {
        if (!mobileQuery.matches) {
          setOpen(false);
        }
      });
    } else if (typeof mobileQuery.addListener === 'function') {
      mobileQuery.addListener(function () {
        if (!mobileQuery.matches) {
          setOpen(false);
        }
      });
    }

    setOpen(false);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.nav-bar').forEach(initNavBar);
  });
})();
