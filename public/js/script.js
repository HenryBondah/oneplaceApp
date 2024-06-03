// Common scripts
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
