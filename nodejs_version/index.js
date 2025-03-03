const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;

// Twilio Credentials
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Environment check
console.log('Environment check:', {
    accountSid: twilioAccountSid?.slice(0, 5),
    authTokenSet: !!twilioAuthToken,
    phoneNumber: twilioPhoneNumber
});

const app = express();

// Middleware to parse incoming requests
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const client = twilio(twilioAccountSid, twilioAuthToken);

// OpenAI API setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Route to handle incoming WhatsApp voice messages
app.post('/whatsapp/voice', async (req, res) => {
    try {
        const { MessageType, MediaUrl0, From } = req.body;
        
        if (!MediaUrl0) {
            return res.status(400).json({ error: 'No media URL provided' });
        }

        const audioResponse = await axios.get(MediaUrl0, {
            responseType: 'arraybuffer',
            auth: {
                username: twilioAccountSid,
                password: twilioAuthToken
            }
        });

        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        const tempFile = path.join(tempDir, 'temp.ogg');
        fs.writeFileSync(tempFile, audioResponse.data);

        const transcript = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFile),
            model: "whisper-1",
        });

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You're an English teacher helping students learn." },
                { role: "user", content: transcript.text }
            ]
        });

        // Send both text and voice responses
        const aiResponse = completion.choices[0].message.content;
        
        await sendTextResponse(aiResponse, From);
        await sendVoiceResponse(aiResponse, From);

        fs.unlinkSync(tempFile);
        res.status(200).json({ success: true });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
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

// Function to send voice response to WhatsApp user
async function sendVoiceResponse(message, toPhoneNumber) {
    try {
        const twiml = new VoiceResponse();
        twiml.say({
            voice: 'Polly.Joanna',
            language: 'en-US'
        }, message);

        await client.calls.create({
            twiml: twiml.toString(),
            to: toPhoneNumber,
            from: twilioPhoneNumber
        });

        console.log('Voice response sent to WhatsApp');
    } catch (error) {
        console.error('Error sending voice response:', error);
    }
}

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
