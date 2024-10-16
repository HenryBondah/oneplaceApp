const express = require('express');
const router = express.Router();
const { commonController } = require('../controllers/commonController');
const { isAuthenticated } = require('../middleware/middleware');
const { upload } = require('../middleware/s3Upload');

module.exports = (db) => {
    router.get('/orgDashboard', isAuthenticated, (req, res) => commonController.orgDashboard(req, res, db));
    router.get('/orgDashboard/schoolYearId/:schoolYearId/termId/:termId', isAuthenticated, (req, res) => commonController.orgDashboardRestricted(req, res, db));
    router.get('/publicDashboardContent', (req, res) => commonController.publicDashboardContent(req, res, db));
    router.get('/addStudent', isAuthenticated, (req, res) => commonController.addStudentGet(req, res, db));
    router.post('/addStudent', upload.single('studentImage'), isAuthenticated, (req, res) => commonController.addStudentPost(req, res, db));
    router.get('/studentDetails', isAuthenticated, (req, res) => commonController.studentDetails(req, res, db));
    router.get('/management', isAuthenticated, (req, res) => commonController.management(req, res, db));
    router.get('/editStudent', isAuthenticated, (req, res) => commonController.editStudentGet(req, res, db));
    router.post('/editStudent/:studentId', upload.single('studentImage'), isAuthenticated, (req, res) => commonController.editStudentPost(req, res, db));
    router.post('/deleteStudent/:studentId', isAuthenticated, (req, res) => commonController.deleteStudent(req, res, db));
    router.post('/saveAttendanceForDate', (req, res) => commonController.saveAttendance(req, res, db));
    router.get('/getAttendanceForClass', isAuthenticated, (req, res) => commonController.getAttendanceForClass(req, res, db));
    router.get('/attendance', isAuthenticated, (req, res) => commonController.attendance(req, res, db));
    router.get('/attendanceCollection', isAuthenticated, (req, res) => commonController.attendanceCollection(req, res, db));
    router.get('/createEmployee', isAuthenticated, (req, res) => commonController.createEmployeeGet(req, res, db));
    router.post('/createEmployee', isAuthenticated, (req, res) => commonController.createEmployeePost(req, res, db));
    router.get('/manageEmployees', isAuthenticated, (req, res) => commonController.manageEmployees(req, res, db));
    router.get('/modifyEmployee', isAuthenticated, (req, res) => commonController.modifyEmployeeGet(req, res, db));
    router.post('/modifyEmployee/:userId', isAuthenticated, (req, res) => commonController.modifyEmployeePost(req, res, db));
    router.post('/deleteEmployee/:userId', isAuthenticated, (req, res) => commonController.deleteEmployee(req, res, db));
    router.post('/toggleHoldEmployee/:userId', isAuthenticated, (req, res) => commonController.toggleHoldEmployee(req, res, db));
    router.get('/assessment', isAuthenticated, (req, res) => commonController.assessment(req, res, db));
    router.post('/createTest', isAuthenticated, (req, res) => commonController.createTest(req, res, db));
    router.get('/getAssessments', isAuthenticated, (req, res) => commonController.getAssessments(req, res, db));
    router.get('/getScores', isAuthenticated, (req, res) => commonController.getScores(req, res, db));
    router.get('/manageAssessment', isAuthenticated, (req, res) => commonController.manageAssessment(req, res, db));
    router.post('/updateAssessments', isAuthenticated, (req, res) => commonController.updateAssessments(req, res, db));
    router.post('/deleteAssessment', isAuthenticated, (req, res) => commonController.deleteAssessment(req, res, db));
    router.post('/saveAllScores', isAuthenticated, (req, res) => commonController.saveAllScores(req, res, db));  // This now handles single and all scores
    router.get('/getSubjectsForClass', isAuthenticated, (req, res) => commonController.getSubjectsForClass(req, res, db));
    router.get('/classDashboard', isAuthenticated, (req, res) => commonController.classDashboard(req, res, db));
    router.post('/registerSchoolYear', isAuthenticated, (req, res) => commonController.registerSchoolYear(req, res, db));
    router.get('/registerSchoolYear', isAuthenticated, (req, res) => commonController.registerSchoolYearGet(req, res, db));
    router.get('/getClasses', isAuthenticated, (req, res) => commonController.getClasses(req, res, db));
    router.post('/registerSchoolYearEvent', isAuthenticated, (req, res) => commonController.registerSchoolYearEvent(req, res, db));
    router.post('/registerSchoolYearAnnouncement', isAuthenticated, (req, res) => commonController.registerSchoolYearAnnouncement(req, res, db));
    router.get('/manageRecords', isAuthenticated, (req, res) => commonController.manageRecords(req, res, db));
    router.post('/updateSchoolYearAndTerms', isAuthenticated, (req, res) => commonController.updateSchoolYearAndTerms(req, res, db));
    router.post('/updateEvent', isAuthenticated, (req, res) => commonController.updateEvent(req, res, db));
    router.post('/updateAnnouncement', isAuthenticated, (req, res) => commonController.updateAnnouncement(req, res, db));
    router.get('/addClassSubject', isAuthenticated, (req, res) => commonController.addClassSubject(req, res, db));
    router.post('/addClass', isAuthenticated, (req, res) => commonController.addClass(req, res, db));
    router.post('/addSubject', isAuthenticated, (req, res) => commonController.addSubject(req, res, db));
    router.post('/updateTerm', isAuthenticated, (req, res) => commonController.updateTerm(req, res, db));
    router.post('/deleteTerm', isAuthenticated, (req, res) => commonController.deleteTerm(req, res, db));
    router.post('/addGraduationYearGroup', isAuthenticated, (req, res) => commonController.addGraduationYearGroup(req, res, db));
    router.get('/manageClassSubjectAndGradYr', isAuthenticated, (req, res) => commonController.manageClassSubjectAndGradYr(req, res, db));
    router.get('/deleteGraduationYearGroup', isAuthenticated, (req, res) => commonController.deleteGraduationYearGroup(req, res, db));
    router.post('/editGraduationYearGroup', isAuthenticated, (req, res) => commonController.editGraduationYearGroup(req, res, db));
    router.get('/deleteClass', isAuthenticated, (req, res) => commonController.deleteClass(req, res, db));
    router.post('/editClass', isAuthenticated, (req, res) => commonController.editClass(req, res, db));
    router.get('/getSubjectsByClass', isAuthenticated, (req, res) => commonController.getSubjectsByClass(req, res, db));
    router.get('/deleteStudentImage/:studentId', isAuthenticated, (req, res) => commonController.deleteStudentImage(req, res, db));
    router.get('/deleteSubject', isAuthenticated, (req, res) => commonController.deleteSubject(req, res, db));
    router.post('/editSubject', isAuthenticated, (req, res) => commonController.editSubject(req, res, db));
    router.get('/getGradYearGroupByClassId', isAuthenticated, (req, res) => commonController.getGradYearGroupByClassId(req, res, db));
    router.get('/getMajorityGraduationYearGroup', isAuthenticated, (req, res) => commonController.getMajorityGraduationYearGroup(req, res, db));
    router.get('/closeSchoolYear', isAuthenticated, (req, res) => commonController.closeSchoolYear(req, res, db));
    router.get('/termDetails/:termId', isAuthenticated, (req, res) => commonController.termDetails(req, res, db));
    router.get('/closeGraduationYearGroup', isAuthenticated, (req, res) => commonController.closeGraduationYearGroup(req, res, db));
    router.post('/closeGraduationYearGroupPost', isAuthenticated, (req, res) => commonController.closeGraduationYearGroupPost(req, res, db));
    router.post('/deleteEvent', isAuthenticated, (req, res) => commonController.deleteEvent(req, res, db));
    router.post('/deleteAnnouncement', isAuthenticated, (req, res) => commonController.deleteAnnouncement(req, res, db));
    router.post('/deleteSchoolYear', isAuthenticated, (req, res) => commonController.deleteSchoolYear(req, res, db));
    router.post('/deleteSchoolYearPost', isAuthenticated, (req, res) => commonController.deleteSchoolYearPost(req, res, db));
    router.post('/setMainEmployee', isAuthenticated, (req, res) => commonController.setMainEmployee(req, res, db));
    router.post('/saveSingleAttendance', (req, res) => commonController.saveSingleAttendance(req, res, db));


    // Event & Announcement Forms
    router.get('/createEventAnnouncement', isAuthenticated, (req, res) => commonController.createEventAnnouncementGet(req, res, db));
    router.post('/createEventAnnouncement', isAuthenticated, (req, res) => commonController.createEventAnnouncementPost(req, res, db));
    router.get('/manageSchoolYear', isAuthenticated, (req, res) => commonController.manageSchoolYearGet(req, res, db));
    router.get('/manageEventsAnnouncements', isAuthenticated, (req, res) => commonController.manageEventsAnnouncementsGet(req, res, db));
    router.get('/manageEventsAnnouncements/schoolYearId/:schoolYearId/termId/:termId', isAuthenticated, (req, res) => commonController.manageEventsAnnouncementsGet(req, res, db));

    // Create Event Announcement with schoolYearId and termId
    router.get('/createEventAnnouncement/schoolYearId/:schoolYearId/termId/:termId', isAuthenticated, (req, res) => commonController.createEventAnnouncementGet(req, res, db));

    return router;
};
