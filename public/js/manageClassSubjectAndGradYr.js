function fetchSubjects() {
    const classId = document.getElementById('classSelect').value;
    if (!classId) {
        document.getElementById('subjectsContainer').innerHTML = '';
        return;
    }
    
    fetch(`/api/getSubjectsByClass?classId=${classId}`)
        .then(response => response.json())
        .then(subjects => {
            let html = subjects.map(subject =>
                `<div>
                    <span>${subject.subject_name}</span>
                    <button onclick="editSubject('${subject.subject_id}', '${subject.subject_name}')">Edit</button>
                    <button onclick="deleteSubject('${subject.subject_id}')">Delete</button>
                </div>`
            ).join('');
            document.getElementById('subjectsContainer').innerHTML = html;
        })
        .catch(error => console.error('Error fetching subjects:', error));
}

function editSubject(subjectId, currentName) {
    const newName = prompt("Enter new name for the subject", currentName);
    if (newName && newName !== currentName) {
        fetch(`/api/editSubject?subjectId=${subjectId}&newName=${encodeURIComponent(newName)}`, { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert('Subject updated successfully!');
                    fetchSubjects(); // Refresh list
                }
            })
            .catch(error => console.error('Error updating subject:', error));
    }
}

function deleteSubject(subjectId) {
    if (confirm("Are you sure you want to delete this subject?")) {
        fetch(`/api/deleteSubject?subjectId=${subjectId}`, { method: 'DELETE' })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert('Subject deleted successfully!');
                    fetchSubjects(); // Refresh list
                }
            })
            .catch(error => console.error('Error deleting subject:', error));
    }
}
