function toggleEditMode() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    const editButton = document.querySelector('.edit-button');
    const saveLinks = document.querySelectorAll('.save-link');
    const isEditable = checkboxes[0].disabled;

    checkboxes.forEach(checkbox => {
        checkbox.disabled = !isEditable;
    });
    
    if (isEditable) {
        editButton.textContent = 'Save Changes';
        saveLinks.forEach(link => link.style.display = 'inline');
    } else {
        editButton.textContent = 'Edit';
        saveLinks.forEach(link => link.style.display = 'none');
    }
}

function saveAttendanceForDate(date) {
    const checkboxes = document.querySelectorAll(`input[data-date='${date}']`);
    const attendanceData = [];

    checkboxes.forEach(checkbox => {
        attendanceData.push({
            studentId: checkbox.dataset.studentId,
            date: date,
            status: checkbox.checked ? 'Present' : 'Absent'
        });
    });

    axios.post('/common/saveAttendanceForDate', { attendance: attendanceData, classId: '<%= classId %>' })
        .then(response => {
            alert(`Attendance for ${date} saved successfully!`);
            window.location.reload(); // Reload the page to update timestamps and totals
        })
        .catch(error => {
            console.error('Error saving attendance:', error);
            alert('Failed to save attendance. Please try again.');
        });
}
