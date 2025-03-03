const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const app = express();

// Middleware to parse incoming requests
app.use(bodyParser.urlencoded({ extended: false }));

// Twilio Credentials (should be in .env for security)
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(twilioAccountSid, twilioAuthToken);

// OpenAI API setup
const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

// Route to handle incoming WhatsApp voice messages
app.post('/whatsapp/voice', async (req, res) => {
  try {
    // Get the URL of the voice message
    const recordingUrl = req.body.RecordingUrl;
    const recordingDuration = req.body.RecordingDuration;

    // Check if we got a valid recording
    if (!recordingUrl) {
      return res.status(400).send('No voice recording received.');
    }

    // Get transcription from Twilio's speech recognition
    const transcriptionText = await getTranscription(recordingUrl);

    // Send transcribed text to OpenAI to generate a response
    const aiResponse = await generateAIResponse(transcriptionText);

    // Convert AI response to speech and send as a voice message
    const twilioResponse = new twilio.twiml.VoiceResponse();
    twilioResponse.say(aiResponse);

    // Respond with the voice message
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
    const completion = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [{ role: 'user', content: text }],
    });

    return completion.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating AI response:', error);
    throw new Error('Failed to generate AI response');
  }
}

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
