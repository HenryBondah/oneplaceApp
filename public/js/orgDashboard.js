document.addEventListener('DOMContentLoaded', function () {
    const currentDateElement = document.getElementById('currentDate');
    const currentTimeElement = document.getElementById('currentTime');
    const termCountdownElement = document.getElementById('termCountdown');

    function updateDateTime() {
        const now = new Date();
        currentDateElement.textContent = now.toLocaleDateString();
        currentTimeElement.textContent = now.toLocaleTimeString();
    }

    updateDateTime();
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
