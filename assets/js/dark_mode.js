/* Attach click listener to the light-toggle button */
(function attach() {
  var btn = document.getElementById("light-toggle");
  if (btn) {
    btn.addEventListener("click", function () {
      if (typeof window.toggleTheme === "function") window.toggleTheme();
    });
  } else {
    /* DOM not ready yet — retry once after DOMContentLoaded */
    document.addEventListener("DOMContentLoaded", function () {
      var btn2 = document.getElementById("light-toggle");
      if (btn2) {
        btn2.addEventListener("click", function () {
          if (typeof window.toggleTheme === "function") window.toggleTheme();
        });
      }
    });
  }
})();
