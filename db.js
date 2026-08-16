require('dotenv').config();
const mysql = require("mysql2");

const connection = mysql.createConnection({
    host: process.env.db_host,
    user: process.env.db_user,
    password: process.env.db_pass,
    database: process.env.db_name
});

connection.connect((err) => {
    if (err) {
        console.log("Database Connection Failed");
        console.log(err);
        return;
    }

    console.log("MySQL Connected");
});

module.exports = connection;