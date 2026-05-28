(function () {
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('#serviceAreasGrid').forEach(function (grid, gridIndex) {
      grid.classList.add('service-areas-accordion-ready');

      grid.querySelectorAll('.county-card').forEach(function (card, cardIndex) {
        var heading = card.querySelector('.county-name');
        var cityList = card.querySelector('.city-list');
        if (!heading || !cityList) return;

        var listId = cityList.id || 'county-cities-' + gridIndex + '-' + cardIndex;
        cityList.id = listId;
        cityList.hidden = true;
        cityList.setAttribute('aria-hidden', 'true');

        cityList.querySelectorAll('[data-extra-city]').forEach(function (city) {
          city.classList.remove('city-collapsed');
          city.removeAttribute('aria-hidden');
        });

        card.querySelectorAll('.toggle-btn').forEach(function (oldToggle) {
          oldToggle.remove();
        });

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'county-toggle';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', listId);

        var label = document.createElement('span');
        label.className = 'county-toggle-label';
        while (heading.firstChild) {
          label.appendChild(heading.firstChild);
        }

        var count = cityList.querySelectorAll('.city-item').length;
        var meta = document.createElement('span');
        meta.className = 'county-toggle-meta';
        meta.textContent = count + ' cit' + (count === 1 ? 'y' : 'ies');

        var icon = document.createElement('span');
        icon.className = 'county-toggle-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '+';

        button.appendChild(label);
        button.appendChild(meta);
        button.appendChild(icon);
        heading.appendChild(button);

        button.addEventListener('click', function () {
          var isOpen = button.getAttribute('aria-expanded') === 'true';
          var nextOpen = !isOpen;
          button.setAttribute('aria-expanded', String(nextOpen));
          cityList.hidden = !nextOpen;
          cityList.setAttribute('aria-hidden', String(!nextOpen));
          card.classList.toggle('is-county-open', nextOpen);
          icon.textContent = nextOpen ? '-' : '+';
        });
      });
    });
  });
})();
