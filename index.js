const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const { MongoClient, ServerApiVersion, MongoRuntimeError, ObjectId } = require('mongodb');


const app = express();
const port = process.env.PORT || 5000;


app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ewkaosd.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.this.status(401).send({ message: 'UnAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

function sendPaymentConfirmationEmail(booking){
    const {patient, patientName, treatment, date, slot} = booking;

    var email= {
        from: process.env.EMAIL_SENDER,
        to:patient,
        subject: `We have received your payment for ${treatment} is on ${date} at ${slot} is confirmed`,
        text: `Your payment for this Appointment ${treatment} is on ${date} at ${slot} is confirmed`,
        html: `
            <div>
                <p>Hello ${patientName} </p>
                <h3>Thank you for your Payment.</h3>
                <h3>We have received your payment</h3>
                <p>Looking forward to seeing you on ${date} at ${slot}.</p>
                <h3>Our Address</h3>
                <p>Uttare, Dhake<p>
                <p>Bangladesh</p>
                <a href="">Unsubscribe</a>
            </div>
        `
    };
    emailClient.sendMail(email, function(err, info){
        if(err){
            console.log(err)
        }
        else{
            console.log('Message sent:', info);
        }
    });
}

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('doctors_portal').collection('services');
        const bookingCollection = client.db('doctors_portal').collection('bookings');
        const userCollection = client.db('doctors_portal').collection('users');
        const doctorCollection = client.db('doctors_portal').collection('doctors');
        const paymentCollection = client.db('doctors_portal').collection('payments');

        const verifyAdmin = async (req, res, next) => {
            const initiotor = req.decoded.email;
            const initiotorAccount = await userCollection.findOne({ email: initiotor });
            if (initiotorAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }
        }

        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);
        });

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send({ success: true, result });
        });


        //warning:
        //This is not the proper way to query
        //After learning more abour mongodb. use aggregate lookup, pipline, match, group
        app.get('/available', async (req, res) => {
            const date = req.body.date;
            //step 1: get all service
            const services = await serviceCollection.find().toArray();

            //step 2: get the booking of that day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            //step 3: for each service , 
            services.forEach(service => {
                // step 4: find bookings for that service
                const serviceBookings = bookings.filter(b => b.treatment === service.name);
                const booked = serviceBookings.map(s => s.slot);
                // service.booked =booked; 
                // service.booked = serviceBookings.map(s => s.slot);
                const available = service.slots.filter(slot => !booked.includes(slot));
                service.slots = available;

            })
            res.send(services);
        });
        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            // const authorization = req.headers.authorization;
            // console.log('auth',authorization);
            else {
                return res.status(403).send({ message: 'forbidden access' });
            }

        });
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token });
        });

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);

        });

        app.put('/user/admin/:email', verifyJWT,verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send({ result });

        });
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        });
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        });
        app.get('/doctor',verifyJWT,verifyAdmin, async(req, res) =>{
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        });
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const query = {email: email};
            const result = await doctorCollection.deleteOne(query);
            res.send(result);
        });
        app.get('/booking/:id',verifyJWT, async(req, res) =>{
            const id = req.params.id;
            const query = {_id: ObjectId(id)};
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        });
        app.post('/create-payment-intent',verifyJWT, async(req,res) =>{
            const service = req.body;
            const price = service.price;
            const amount = price*10;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types:['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret})
        });
        app.patch('/booking/:id',verifyJWT, async(req,res) =>{
            const booking = req.params.id;
            const payment = req.body;
            const query = {_id: ObjectId(booking)};
            const updatedDoc= {
                $set: {
                    paid: true,
                    transcationId: payment.transcationId
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(query, updatedDoc);
            res.send(updatedDoc);
        });
    }
    finally {

    }
}
run().catch(console.dir);
app.get('/', (req, res) => {
    res.send('Hello Doctor');
})

app.listen(port, () => {
    console.log(`Doctor App listening on por ${port}`)

})