// routes/accountRoute.js
const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/s3Upload');

router.get('/register', accountController.registerGet);
router.post('/register', upload.fields([{ name: 'proof1' }, { name: 'proof2' }]), accountController.registerPost);
router.get('/login', accountController.loginGet);
router.post('/login', accountController.loginPost);
router.get('/logout', isAuthenticated, accountController.logoutGet);
router.get('/account', isAuthenticated, accountController.accountGet);
router.get('/update', isAuthenticated, accountController.updateGet);
router.post('/update', isAuthenticated, accountController.updatePost);
router.get('/personalization', isAuthenticated, accountController.personalizationGet);
router.post('/personalization', isAuthenticated, accountController.personalizationPost);
router.post('/personalization/logo', upload.single('logo'), accountController.personalizationLogoPost);

router.get('/managePublicContent', isAuthenticated, accountController.managePublicContentGet);
router.post('/uploadSlideshowImages', isAuthenticated, upload.array('slideshowImages'), accountController.uploadSlideshowImages);
router.post('/addTextSection', isAuthenticated, accountController.addTextSection);
router.post('/updateImage', isAuthenticated, accountController.updateImagePost);
router.get('/deleteImage/:imageId', isAuthenticated, accountController.deleteImageGet);
router.post('/updateText', isAuthenticated, accountController.updateTextPost);
router.get('/deleteText/:textId', isAuthenticated, accountController.deleteTextGet);

module.exports = router;
