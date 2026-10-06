// Apply the preferred mode before the application paints.
(function () {
  var preference;
  try { preference = localStorage.getItem('mavenhost-theme'); } catch (_) {}
  var mode = preference === 'light' || preference === 'dark' ? preference
    : 'dark';
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
})();
