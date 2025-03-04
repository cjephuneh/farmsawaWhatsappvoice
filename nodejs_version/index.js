const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');  // Corrected import
require('dotenv').config();

const app = express();

// Middleware to parse incoming requests
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Twilio Credentials (should be in .env for security)
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(twilioAccountSid, twilioAuthToken);

// OpenAI API setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Route to handle incoming WhatsApp voice messages
app.post('/whatsapp/voice', async (req, res) => {
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('Query:', req.query);
    
    // Add request body validation
    if (!req.body || Object.keys(req.body).length === 0) {
        console.log('Empty request body received');
        return res.status(400).send('Empty request body');
    }
    
    console.log(req.body);  // Log incoming request body
    try {
      const recordingUrl = req.body.RecordingUrl;
      const recordingDuration = req.body.RecordingDuration;
  
      if (!recordingUrl) {
        return res.status(400).send('No voice recording received.');
      }
  
      // Get transcription from Twilio's speech recognition
      const transcriptionText = await getTranscription(recordingUrl);
  
      // Send transcribed text to OpenAI to generate a response
      const aiResponse = await generateAIResponse(transcriptionText);
  
      // Convert AI response to speech and send as a voice message
      const twilioResponse = new twilio.twiml.VoiceResponse();
  
      // Convert the AI response text to speech using <Say>
      twilioResponse.say(aiResponse, { voice: 'alice', language: 'en-US' });
  
      // Respond with the voice message (sending both text and voice responses)
      sendWhatsAppTextResponse(aiResponse, req.body.From);
  
      // Send voice message back
      res.type('text/xml').send(twilioResponse.toString());
    } catch (error) {
      console.error('Error processing voice message:', error);
      res.status(500).send('Internal Server Error');
    }
  });
  

// Function to get transcription from Twilio (using their recording URL)
async function getTranscription(recordingUrl) {
  try {
    const recordingSid = recordingUrl.split('/').pop(); // Extract the SID from the URL
    const recording = await client.recordings(recordingSid).fetch();

    if (recording.status === 'completed') {
      // Get the transcription of the recording
      const transcription = await client.transcriptions.create({
        recordingSid: recordingSid,
      });

      return transcription.transcriptionText;
    } else {
      throw new Error('Recording is not completed yet');
    }
  } catch (error) {
    console.error('Error fetching transcription:', error);
    throw new Error('Failed to fetch transcription');
  }
}

// Function to generate a response from OpenAI's GPT model
async function generateAIResponse(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: text }],
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating AI response:', error);
    throw new Error('Failed to generate AI response');
  }
}

// Function to send text response to WhatsApp user
async function sendWhatsAppTextResponse(aiResponse, toPhoneNumber) {
  try {
    await client.messages.create({
      body: aiResponse,  // Send the text response
      from: `whatsapp:${twilioPhoneNumber}`,  // Your Twilio WhatsApp number
      to: `whatsapp:${toPhoneNumber}`,  // The phone number that sent the message
    });
    console.log('Text response sent to WhatsApp');
  } catch (error) {
    console.error('Error sending text response:', error);
  }
}

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
