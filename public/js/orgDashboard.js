// orgdashboard page specific scripts
function updateDateTime() {
    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', dateOptions);
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-US', timeOptions);
}

updateDateTime(); // Update on load
setInterval(updateDateTime, 1000); // Update every second

function deleteEvent(eventId) {
    fetch('/common/deleteEvent', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ eventId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Event deleted successfully!');
            window.location.reload(); // Reload the page to update the list
        } else {
            alert('Failed to delete event: ' + data.message);
        }
    })
    .catch(error => alert('Failed to delete event: ' + error));
}

function deleteAnnouncement(announcementId) {
    fetch('/common/deleteAnnouncement', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ announcementId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert('Announcement deleted successfully!');
            window.location.reload(); // Reload the page to update the list
        } else {
            alert('Failed to delete announcement: ' + data.message);
        }
    })
    .catch(error => alert('Failed to delete announcement: ' + error));
}
