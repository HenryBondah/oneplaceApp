document.addEventListener('DOMContentLoaded', function () {
    const currentDateElement = document.getElementById('currentDate');
    const currentTimeElement = document.getElementById('currentTime');
    const termCountdownElement = document.getElementById('termCountdown');

  // index page specific scripts
  document.addEventListener("DOMContentLoaded", function () {
    function updateDateTime() {
        const now = new Date();
        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
        document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', dateOptions);
        document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-US', timeOptions);
    }

    updateDateTime(); // Update on load
    setInterval(updateDateTime, 1000); // Update every second
});

    setInterval(updateDateTime, 1000);

    function calculateCountdown(term) {
        const now = new Date();
        const startDate = new Date(term.start_date);
        const endDate = new Date(term.end_date);

        if (now < startDate) {
            const daysUntilStart = Math.ceil((startDate - now) / (1000 * 60 * 60 * 24));
            termCountdownElement.textContent = `Term starts in ${daysUntilStart} days...`;
        } else if (now >= startDate && now <= endDate) {
            const daysPassed = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));
            const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            termCountdownElement.textContent = `Day ${daysPassed}/${totalDays} of the term`;
        } else {
            termCountdownElement.textContent = 'Term has ended.';
        }
    }

    // Assume `currentYear` is a global variable set in the EJS template
    if (typeof currentYear !== 'undefined' && currentYear.terms.length > 0) {
        calculateCountdown(currentYear.terms[0]);
    }
});
