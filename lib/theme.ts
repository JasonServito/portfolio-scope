// Runs in <head> before the first paint, so a page never flashes the wrong
// theme. Pages are dark unless the visitor picks light, and the script also
// handles clicks on the theme toggle, so the toggle works before (or without)
// hydration. The CSP allows this exact text by hash (see proxy.ts).
export const themeScript = `(function () {
  var root = document.documentElement;
  var choice = null;
  try {
    choice = localStorage.getItem("theme");
  } catch (error) {}
  function apply() {
    root.classList.toggle("dark", choice !== "light");
  }
  apply();
  window.addEventListener("storage", function (event) {
    if (event.key !== "theme" && event.key !== null) return;
    choice = event.newValue;
    apply();
  });
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-theme-toggle]")) {
      return;
    }
    choice = root.classList.contains("dark") ? "light" : "dark";
    try {
      localStorage.setItem("theme", choice);
    } catch (error) {}
    apply();
  });
})();`;
