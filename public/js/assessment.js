document.getElementById('addTestForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const testName = document.getElementById('testName').value;
    const testWeight = document.getElementById('testWeight').value;
    const classId = '<%= classId %>';
    const subjectId = '<%= subjectId %>';

    fetch('/createTest', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ testName, testWeight, classId, subjectId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.title) {
            alert('Test added successfully');
            location.reload();
        } else {
            alert('Failed to add test');
        }
    })
    .catch(error => console.error('Error:', error));
});

document.getElementById('saveScoresForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const formData = new FormData(this);
    const scores = [];

    for (let [key, value] of formData.entries()) {
        const [studentId, assessmentId] = key.match(/\d+/g);
        scores.push({ studentId: parseInt(studentId), assessmentId: parseInt(assessmentId), score: parseFloat(value) });
    }

    fetch('/common/saveScores', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ scores })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(data.message);
            location.reload();
        } else {
            alert('Failed to save scores.');
        }
    })
    .catch(error => console.error('Error:', error));
});

// Function to calculate grade based on total percentage
function calculateGrade(percentage) {
    if (percentage >= 90) return 'A';
    if (percentage >= 80) return 'B';
    if (percentage >= 70) return 'C';
    if (percentage >= 60) return 'D';
    return 'F';
}

// Function to update total percentage and grade
function updateTotalAndGrade(studentId, totalPercentage, grade) {
    document.getElementById(`total-percentage-${studentId}`).textContent = totalPercentage.toFixed(2);
    document.getElementById(`grade-${studentId}`).textContent = grade;
}

document.getElementById('saveScoresForm').addEventListener('change', function() {
    const scores = [];
    const assessments = <%- JSON.stringify(assessments) %>;
    const students = <%- JSON.stringify(students) %>;

    students.forEach(student => {
        let totalPercentage = 0;
        assessments.forEach(assessment => {
            const scoreInput = document.querySelector(`input[name="scores[${student.student_id}][${assessment.assessment_id}]"]`);
            if (scoreInput && scoreInput.value) {
                totalPercentage += parseFloat(scoreInput.value) * (assessment.weight / 100);
            }
        });
        const grade = calculateGrade(totalPercentage);
        updateTotalAndGrade(student.student_id, totalPercentage, grade);
    });
});
