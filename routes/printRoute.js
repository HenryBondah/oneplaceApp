// printRoute.js
module.exports = function(app) {
    // Route for printing a basic student report
    app.get('/print/printStudent', (req, res) => {
        const studentData = {
            orgName: "Sample High School",
            image: "/images/student1.png",
            name: "John Doe",
            subjects: [
                { name: "Math", grade: "A" },
                { name: "Science", grade: "B+" },
                { name: "History", grade: "A-" }
            ]
        };

        // Ensure all necessary variables are provided
        res.render('print/printStudent', {
            student: studentData,
            orgName: studentData.orgName || 'Default School Name',
            date: new Date().toLocaleDateString(),
            title: 'Print Student'  // Ensure title is set for layout consistency
        });
    });

    // Route for printing detailed student report with remarks
    app.get('/print/printStudentReport', (req, res) => {
        const studentData = {
            orgName: "Sample High School",
            image: "/images/student1.png",
            name: "John Doe",
            subjects: [
                { name: "Math", grade: "A" },
                { name: "Science", grade: "B+" },
                { name: "History", grade: "A-" }
            ],
            teacherRemarks: "",  // Default empty string if not fetched
            headTeacherRemarks: ""  // Default empty string if not fetched
        };

        res.render('print/printStudentReport', {
            student: studentData,
            orgName: studentData.orgName || 'Default School Name',
            date: new Date().toLocaleDateString(),
            title: 'Student Final Report'  // Ensure title is set for layout consistency
        });
    });
};
