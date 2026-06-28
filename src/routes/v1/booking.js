const express = require('express');
const { BookingController } = require('../../controllers');

const router = express.Router();

router.post('/', BookingController.createBooking);
router.post('/payments', BookingController.makePayment);
router.get('/:id', BookingController.getBooking);
router.get('/user/:userId', BookingController.getUserBookings);
router.post('/:id/cancel', BookingController.cancelBooking);

module.exports = router;