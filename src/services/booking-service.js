const axios = require("axios");

// Shared HTTP client for all inter-service calls with an explicit timeout.
// Without this, axios.get/post will hang indefinitely when the Flights Service
// is cold-starting on Render, blocking the open DB transaction forever.
const flightServiceClient = axios.create({
  timeout: 30000, // 30-second timeout for Flights Service calls
});
const { StatusCodes } = require("http-status-codes");

const { BookingRepository } = require("../repositories");
const { ServerConfig,Queue } = require("../config");
const db = require("../models");
const AppError = require("../utils/errors/app-error");
const {Enums}=require('../utils/common');
const {BOOKED,CANCELLED}=Enums.BOOKING_STATUS;

const bookingRepository=new BookingRepository();

async function createBooking(data) {
  const transaction = await db.sequelize.transaction();
  try{
    const flight = await flightServiceClient.get(`${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}`);
    const flightData = flight.data.data;
    
    const seatNumbers = data.seatNumbers || [];
    const noOfSeats = seatNumbers.length;
    if (noOfSeats === 0) {
      throw new AppError("At least one seat must be selected", StatusCodes.BAD_REQUEST);
    }

    // Call Flights Service to hold the selected seats
    const holdResponse = await flightServiceClient.post(`${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}/seats/hold`, {
      seatNumbers: seatNumbers,
      holdBy: data.userId.toString() // String representation of holder
    });

    const heldSeats = holdResponse.data.data;
    const seatIds = heldSeats.map(seat => seat.id);
    const resolvedSeatNumbers = heldSeats.map(seat => seat.seatNumber);

    // Calculate total cost based on base price and individual seat fareMultiplier
    let totalCost = 0;
    for (const seat of heldSeats) {
      totalCost += Math.round(flightData.price * parseFloat(seat.fareMultiplier));
    }

    const bookingPayload = {
      flightId: data.flightId,
      userId: data.userId,
      status: 'INITIATED',
      noOfSeats: noOfSeats,
      totalCost: totalCost,
      seatIds: seatIds,
      seatNumbers: resolvedSeatNumbers
    };

    const booking = await bookingRepository.create(bookingPayload, { transaction });

    await transaction.commit();
    return booking;
  }catch(error){
    await transaction.rollback();
    // If holding seats succeeded but booking creation failed, release the seats in Flights Service
    if (error.response && error.response.status !== StatusCodes.CONFLICT) {
      await flightServiceClient.post(`${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}/seats/release`, {
        seatNumbers: data.seatNumbers,
        holdBy: data.userId.toString()
      }).catch(() => {});
    }
    
    if (error.response && error.response.data && error.response.data.error) {
      throw new AppError(error.response.data.error.explanation || "Failed to hold seats", error.response.status);
    }
    throw error;
  }
}

async function makePayment(data){
  const transaction = await db.sequelize.transaction();
  try {
    const bookingDetails = await bookingRepository.get(data.bookingId, transaction);
    
    if(bookingDetails.status == CANCELLED){
      throw new AppError('The booking has expired', StatusCodes.BAD_REQUEST);
    }
    
    const bookingTime = new Date(bookingDetails.createdAt);
    const currentTime = new Date();
    if(currentTime - bookingTime > 300000){ // 5 minutes expiration
      await transaction.commit(); // Release transaction lock first
      await cancelBooking(data.bookingId);
      throw new AppError('The booking has expired', StatusCodes.BAD_REQUEST);
    }
    
    if(bookingDetails.totalCost != data.totalCost){
      throw new AppError("The amount of the payment doesn't match", StatusCodes.BAD_REQUEST);
    }
    
    if(bookingDetails.userId != data.userId){
       throw new AppError("The user corresponding to the booking doesn't match", StatusCodes.BAD_REQUEST);
    }

    // Call Flights Service to confirm the seat holds
    const parsedSeatNumbers = typeof bookingDetails.seatNumbers === 'string'
      ? JSON.parse(bookingDetails.seatNumbers)
      : bookingDetails.seatNumbers;

    await flightServiceClient.post(`${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${bookingDetails.flightId}/seats/confirm`, {
      seatNumbers: parsedSeatNumbers,
      holdBy: bookingDetails.userId.toString()
    });

    // Payment is successful
    await bookingRepository.update(data.bookingId, { status: BOOKED }, transaction);

    // Resolve the user email from the DB since services share the Flights database
    const [user] = await db.sequelize.query("SELECT email FROM Users WHERE id = :userId", {
      replacements: { userId: bookingDetails.userId },
      type: db.sequelize.QueryTypes.SELECT
    });
    
    const recipientEmail = user ? user.email : 'sri.shruti24@gmail.com';
    const seatNumbersStr = parsedSeatNumbers.join(", ");

    Queue.sendData({
      recepientEmail: recipientEmail,
      subject: 'Flight Ticket Booked - Seat Confirmation',
      text: `Booking successfully done for Booking ID: ${bookingDetails.id}.\nFlight ID: ${bookingDetails.flightId}\nTotal Cost: ₹${bookingDetails.totalCost.toLocaleString('en-IN')}\nYour confirmed seats are: ${seatNumbersStr}.\n\nThank you for flying with Booking Mafia!`
    });

    await transaction.commit();
    return { bookingId: data.bookingId, status: BOOKED };
  } catch (error) {
    await transaction.rollback();
    if (error.response && error.response.data && error.response.data.error) {
      throw new AppError(error.response.data.error.explanation || "Failed to confirm seats", error.response.status);
    }
    throw error;
  }
}

async function cancelBooking(bookingId) {
  const transaction = await db.sequelize.transaction();
  try {
    const bookingDetails = await bookingRepository.get(bookingId, transaction);
    if(bookingDetails.status == CANCELLED) {
      await transaction.commit();
      return true;
    }

    const parsedSeatNumbers = typeof bookingDetails.seatNumbers === 'string'
      ? JSON.parse(bookingDetails.seatNumbers)
      : bookingDetails.seatNumbers;

    // Call Flights Service to release the seats
    await flightServiceClient.post(`${ServerConfig.FLIGHT_SERVICE}/api/v1/flights/${bookingDetails.flightId}/seats/release`, {
      seatNumbers: parsedSeatNumbers,
      holdBy: bookingDetails.userId.toString()
    });

    await bookingRepository.update(bookingId, { status: CANCELLED }, transaction);
    await transaction.commit();
  } catch(error) {
    await transaction.rollback();
    throw error;
  }
}

async function cancelOldBookings() {
  try {
    console.log("Inside service, cancelling old bookings...");
    const time = new Date(Date.now() - 1000 * 300); // 5 mins ago
    
    // Find all bookings created before 'time' that are in INITIATED/PENDING status
    const bookingsToCancel = await db.Booking.findAll({
      where: {
        createdAt: {
          [db.Sequelize.Op.lt]: time
        },
        status: {
          [db.Sequelize.Op.notIn]: [BOOKED, CANCELLED]
        }
      }
    });

    for (const booking of bookingsToCancel) {
      console.log(`Cancelling booking ${booking.id}...`);
      await cancelBooking(booking.id).catch(err => {
        console.error(`Failed to cancel booking ${booking.id}:`, err.message);
      });
    }
    
    return true;
  } catch(error) {
    console.log(error);
  }
}

async function getBookingDetails(bookingId) {
  try {
    const booking = await bookingRepository.get(bookingId);
    return booking;
  } catch (error) {
    throw error;
  }
}

async function getUserBookings(userId) {
  try {
    const bookings = await db.Booking.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']]
    });
    return bookings;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  createBooking,
  makePayment,
  cancelBooking,
  cancelOldBookings,
  getBookingDetails,
  getUserBookings
};
