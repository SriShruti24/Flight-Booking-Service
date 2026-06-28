'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Bookings', 'seatIds', {
      type: Sequelize.JSON,
      allowNull: true
    });
    await queryInterface.addColumn('Bookings', 'seatNumbers', {
      type: Sequelize.JSON,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Bookings', 'seatIds');
    await queryInterface.removeColumn('Bookings', 'seatNumbers');
  }
};
