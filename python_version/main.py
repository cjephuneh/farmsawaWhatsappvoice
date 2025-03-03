# Third-party imports
import openai
from fastapi import FastAPI, Depends, Request
from decouple import config
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

# Internal imports
from models import Conversation, SessionLocal
from utils import send_message, logger, ogg2mp3

openai.api_key = config("OPENAI_API_KEY")

app = FastAPI()

# Dependency
def get_db():
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()


@app.post("/message")
async def reply(request: Request, db: Session = Depends(get_db)):
    # Await for the incoming webhook request to extract information
    # like phone number and the media URL of the voice note
    form_data = await request.form()
    whatsapp_number = form_data['From'].split("whatsapp:")[-1]
    print(f"Chatting with this number: {whatsapp_number}")

    media_url = form_data['MediaUrl0']
    media_type = form_data['MediaContentType0']
    print(f"Media URL: {media_url}\nMedia Content type: {media_type}")

    # Convert the OGG audio to MP3 using ogg2mp3() function
    mp3_file_path = ogg2mp3(media_url)

    with open(mp3_file_path, "rb") as audio_file:
    # Call the OpenAI API to transcribe the audio using Whisper API
        whisper_response = openai.Audio.transcribe(
            file=audio_file,
            model="whisper-1",
            language="en",
            temperature=0.5,
        )
        print(f"""
        Transcribed the voice note to the following text: {whisper_response}.
            Now it's being sent to ChatGPT API to reply…
        """)

    # Call the OpenAI API to generate text with ChatGPT
    messages = [{"role": "user", "content": whisper_response.get("text")}]
    messages.append({"role": "system", "content": "You're an English teacher who has taught 100s of students grammar, idioms, vocab, basic English information, and beyond basics."})
    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=messages,
        max_tokens=200,
        n=1,
        stop=None,
        temperature=0.5
    )


    # The generated text
    chatgpt_response = response.choices[0].message.content
    # Store the conversation in the database
    try:
        conversation = Conversation(
            sender=whatsapp_number,
            message=whisper_response.get("text"),
            response=chatgpt_response
            )
        db.add(conversation)
        db.commit()
        logger.info(f"Conversation #{conversation.id} stored in database")
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Error storing conversation in database: {e}")
    send_message(whatsapp_number, chatgpt_response)
    return ""