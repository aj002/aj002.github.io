/* Theme toggle — works with al-folio main.css icon rules */
(function () {
  function setTheme(mode) {
    if (!mode) mode = "light";
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("theme", mode);

    /* al-folio tables */
    var tables = document.getElementsByTagName("table");
    for (var i = 0; i < tables.length; i++) {
      if (mode === "dark") tables[i].classList.add("table-dark");
      else tables[i].classList.remove("table-dark");
    }

    /* highlight theme sheets (al-folio, may not exist) */
    var hl = document.getElementById("highlight_theme_light");
    var hd = document.getElementById("highlight_theme_dark");
    if (hl && hd) {
      hl.media = mode === "dark" ? "none" : "";
      hd.media = mode === "dark" ? "" : "none";
    }
  }

  function toggleTheme() {
    var current = localStorage.getItem("theme") || "light";
    setTheme(current === "dark" ? "light" : "dark");
  }

  function initTheme() {
    var saved = localStorage.getItem("theme");
    if (!saved || saved === "null") {
      saved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    setTheme(saved);
  }

  /* Expose globally so inline handlers & dark_mode.js can reach them */
  window.setTheme = setTheme;
  window.toggleTheme = toggleTheme;
  window.initTheme = initTheme;

  /* Run immediately */
  initTheme();
})();
