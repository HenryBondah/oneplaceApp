function deleteRecord(type, id) {
    const bodyData = {};
    if (type === 'announcement') {
        bodyData.announcementId = id;
    } else {
        bodyData.id = id;
    }

    if (confirm('Are you sure you want to delete this ' + type + '?')) {
        fetch(`/common/delete${type.charAt(0).toUpperCase() + type.slice(1)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        })
        .then(response => response.json())
        .then(data => {
            if(data.success) {
                alert('Deleted successfully!');
                window.location.reload(); // Reload the page to see the changes
            } else {
                alert('Error: ' + data.message);
            }
        })
        .catch(error => {
            console.error('Failed to delete:', error);
            alert('Failed to delete due to an error.');
        });
    }
}

function deleteEvent(eventId) {
    if (confirm('Are you sure you want to delete this event?')) {
        fetch(`/common/deleteEvent`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ eventId: eventId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Event deleted successfully!');
                window.location.reload();
            } else {
                alert('Deletion failed: ' + data.message);
            }
        })
        .catch(error => {
            console.error('Deletion error:', error);
            alert('Failed to delete due to an error.');
        });
    }
}

function deleteSchoolYear(yearId) {
    if (confirm('Are you sure you want to delete this school year?')) {
        fetch('/common/deleteSchoolYear', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: yearId })
        }).then(() => {
            window.location.reload();
        });
    }
}

function deleteTerm(termId) {
    if (confirm('Are you sure you want to delete this term?')) {
        fetch('/common/deleteTerm', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term_id: termId })
        }).then(() => {
            window.location.reload();
        });
    }
}

function selectAllClasses(termId, checkbox) {
    const checkboxes = document.querySelectorAll(`input[name="term${termId}Classes[]"]`);
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
}
