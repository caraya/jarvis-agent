import 'dotenv/config';

async function getAvailableModels() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("Error: GOOGLE_API_KEY is not set in your .env file.");
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    const data = await response.json();

    console.log("Available models that support 'generateContent':");
    data.models.forEach(model => {
      if (model.supportedGenerationMethods.includes("generateContent")) {
        console.log(`- ${model.name} (${model.displayName})`);
      }
    });

  } catch (error) {
    console.error("Failed to fetch models:", error);
  }
}

getAvailableModels();