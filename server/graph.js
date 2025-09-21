// server/graph.js
import 'dotenv/config'; // Ensure environment variables are loaded first
import { DynamicTool } from "@langchain/core/tools";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { END, START, StateGraph } from "@langchain/langgraph";
import { TavilySearch } from "@langchain/tavily";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import wikipedia from 'wikipedia';
import { parseStringPromise } from 'xml2js';

// --- HELPER FUNCTION ---
// Extracts a JSON string from a markdown code block if present.
const extractJson = (str) => {
  const match = str.match(/```json\n([\s\S]*?)\n```/);
  return match ? match[1] : str;
};


// --- STATE DEFINITION ---
// Defines the shared state that flows through the graph.
const graphState = {
  input: { value: null },
  plan: { value: null },
  pastSteps: {
    value: (x, y) => x.concat(y),
    default: () => [],
  },
  response: { value: null },
  filePath: { value: null },
};

// --- MODEL & TOOL INITIALIZATION ---
// The model can be configured based on environment variables. Defaults to Gemini.
const llm = process.env.OPENAI_API_KEY
  ? new ChatOpenAI({ temperature: 0 })
  : new ChatGoogleGenerativeAI({
      model: "gemini-1.5-flash-latest", // Use a current, valid model name
      temperature: 0,
      apiKey: process.env.GOOGLE_API_KEY, // Explicitly pass the API key
    });

// Initialize the general web search tool using the new, recommended package.
const tavilySearch = new TavilySearch({ maxResults: 3, apiKey: process.env.TAVILY_API_KEY });

// --- TOOL DEFINITIONS ---
// A list of all specialized tools available to the agents.
const tools = [
  tavilySearch, // General web search
  new DynamicTool({
    name: "get_weather_forecast",
    description: "Gets the current weather forecast for a given location.",
    schema: z.object({
        latitude: z.number().describe("The latitude of the location."),
        longitude: z.number().describe("The longitude of the location."),
    }),
    func: async (toolInput) => {
        const latitude = toolInput?.latitude;
        const longitude = toolInput?.longitude;
        if (latitude === undefined || longitude === undefined) {
            return "Error: The tool was called without 'latitude' and 'longitude' in the input.";
        }
        console.log(`[Tool] Getting weather for: Lat ${latitude}, Lon ${longitude}`);
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,rain,showers,wind_speed_10m&temperature_unit=fahrenheit`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            return JSON.stringify(data.current);
        } catch (error) {
            return `Error getting weather forecast: ${error.message}`;
        }
    },
  }),
  new DynamicTool({
    name: "github_repo_search",
    description: "Searches GitHub for repositories matching a query.",
    schema: z.object({ query: z.string().describe("The search query for GitHub repositories.") }),
    func: async (toolInput) => {
      const query = toolInput?.query;
      if (!query) {
          console.error("[Tool Error] github_repo_search received invalid input:", JSON.stringify(toolInput, null, 2));
          return "Error: The tool was called without a 'query' in the input.";
      }
      console.log(`[Tool] Searching GitHub for: ${query}`);
      const response = await fetch(`https://api.github.com/search/repositories?q=${query}&per_page=5`, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
      });
      const data = await response.json();
      return JSON.stringify(data.items.map(item => ({
        full_name: item.full_name,
        url: item.html_url,
        description: item.description,
      })));
    },
  }),
  new DynamicTool({
    name: "file_analyst",
    description: "Analyzes the content of a user-provided file.",
    schema: z.object({
      filePath: z.string().describe("The path to the file to be analyzed."),
      query: z.string().describe("The specific question to ask about the file's content."),
    }),
    func: async (toolInput) => {
      const filePath = toolInput?.filePath;
      const query = toolInput?.query;
      if (!filePath || !query) return "Error: The tool was called without 'filePath' and 'query' in the input.";
      console.log(`[Tool] Analyzing file: ${filePath} for query: ${query}`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const prompt = `File content:\n\n${content}\n\nPlease answer the following question based on the file: ${query}`;
        const result = await llm.invoke(prompt);
        return result.content;
      } catch (error) {
        return `Error reading or analyzing file: ${error.message}`;
      }
    },
  }),
  new DynamicTool({
    name: "wikipedia_search",
    description: "Searches Wikipedia for a given query and returns a summary of the page.",
    schema: z.object({ query: z.string().describe("The search term for Wikipedia.") }),
    func: async (toolInput) => {
      const query = toolInput?.query;
      if (!query) return "Error: The tool was called without a 'query' in the input.";
      console.log(`[Tool] Searching Wikipedia for: ${query}`);
      try {
        const summary = await wikipedia.summary(query);
        return `Summary for "${query}":\n${summary.extract}`;
      } catch (error) {
        return `Could not find a Wikipedia page for "${query}".`;
      }
    },
  }),
  new DynamicTool({
    name: "arxiv_search",
    description: "Searches the ArXiv pre-print server for scientific papers.",
    schema: z.object({ query: z.string().describe("The search query for ArXiv.") }),
    func: async (toolInput) => {
        const query = toolInput?.query;
        if (!query) return "Error: The tool was called without a 'query' in the input.";
        console.log(`[Tool] Searching ArXiv for: ${query}`);
        const response = await fetch(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=3`);
        const xmlData = await response.text();
        const jsonData = await parseStringPromise(xmlData);
        
        const entries = jsonData.feed.entry;
        if (!entries || entries.length === 0) {
            return `No papers found on ArXiv for the query: "${query}"`;
        }
        
        return JSON.stringify(entries.map(entry => ({
            title: entry.title[0],
            summary: entry.summary[0].trim(),
            authors: entry.author.map(a => a.name[0]),
            url: entry.id[0],
        })));
    },
  }),
  new DynamicTool({
    name: "mdn_web_search",
    description: "Searches the Mozilla Developer Network (MDN) for web development documentation.",
    schema: z.object({ query: z.string().describe("The search query for MDN.") }),
    func: async (toolInput) => {
        const query = toolInput?.query;
        if (!query) return "Error: The tool was called without a 'query' in the input.";
        console.log(`[Tool] Searching MDN for: ${query}`);
        const mdnQuery = `site:developer.mozilla.org ${query}`;
        return tavilySearch.invoke({ input: mdnQuery });
    },
  }),
];

// --- AGENT/NODE DEFINITIONS ---

// 1. Planner Agent Node: Creates the initial plan.
const planner = async (state) => {
  console.log("---PLANNER---");
  const planPrompt = `You are a planner agent. Your job is to create a plan to answer a user's query.

  Here is the user's query:
  ${state.input}

  **Your Task:**
  Determine the single best tool to use to answer the user's query.
  - Formulate a clear and concise instruction for the tool.
  - Available tools: [${tools.map(t => t.name).join(", ")}]
  - Respond with a JSON object containing the plan. For example:
    {"plan": ["Use the 'get_weather_forecast' tool for the location specified in the query."]}

  **Important Rules:**
  - You must choose only one step.
  - Your response MUST be a valid JSON object.`;

  const response = await llm.invoke(planPrompt);
  
  let plan;
  try {
    const cleanedJson = extractJson(response.content);
    plan = JSON.parse(cleanedJson).plan;
    console.log("Generated Plan:", plan);
  } catch (e) {
    console.error("Error parsing planner response:", e);
    console.error("Invalid JSON content:", response.content);
    // If parsing fails, create a plan to report the error.
    plan = ["PLAN_COMPLETE"]; 
  }
  
  return { plan };
};

// 2. Tool Execution Node: Executes the tools based on the plan.
const executeTools = async (state) => {
  console.log("---TOOL EXECUTOR (VERBOSE)---");
  console.log("Current State:", JSON.stringify(state, null, 2));

  const lastStep = state.plan[state.plan.length - 1];
  console.log("Plan Step to Execute:", lastStep);
  
  const toolCallPrompt = `Based on the plan step, generate a JSON tool call object for the tool executor.
  Plan Step: "${lastStep}"
  User Query: "${state.input}"
  Available tools: ${JSON.stringify(tools.map(t => ({ name: t.name, description: t.description, schema: t.schema })))}
  
  Your response must be a single JSON object that is a valid tool call, extracting any necessary parameters from the User Query.
  For example: {"tool": "github_repo_search", "tool_input": {"query": "helloworld c++ example"}}`;
  
  console.log("Generating tool call with prompt...");
  const toolCallResponse = await llm.invoke(toolCallPrompt);
  console.log("LLM Response for Tool Call:", toolCallResponse.content);
  
  let toolCall;
  try {
    const cleanedJson = extractJson(toolCallResponse.content);
    console.log("Cleaned JSON for parsing:", cleanedJson);
    toolCall = JSON.parse(cleanedJson);
    console.log("Successfully Parsed Tool Call:", JSON.stringify(toolCall, null, 2));
  } catch (e) {
    console.error("Error parsing tool call response:", e);
    console.error("Invalid JSON content:", toolCallResponse.content);
    const tool_output = "Error: The model generated an invalid tool call. Please try again.";
    return { pastSteps: [{ tool: "error_handler", tool_output }] };
  }
  
  if (toolCall.tool === 'file_analyst' && state.filePath) {
    if (!toolCall.tool_input) toolCall.tool_input = {};
    toolCall.tool_input.filePath = state.filePath;
  }

  const toolToExecute = tools.find((tool) => tool.name === toolCall.tool);
  let tool_output;

  if (!toolToExecute) {
    tool_output = `Error: Tool '${toolCall.tool}' not found. Please select from the available tools.`;
    console.log("Tool execution result:", tool_output);
    return { pastSteps: [{ tool: toolCall.tool || "unknown_tool", tool_output }] };
  } else {
    let inputForTool = toolCall.tool_input;
    console.log("Initial inputForTool from LLM:", JSON.stringify(inputForTool, null, 2));
    
    // Fallback for cases where the LLM fails to generate a valid tool_input object.
    if (!inputForTool) {
        console.warn(`Warning: tool_input for '${toolToExecute.name}' is missing. Using fallback.`);
        inputForTool = { query: state.input }; 
        console.log("Fallback input created:", JSON.stringify(inputForTool, null, 2));
    }

    console.log(`Executing tool '${toolToExecute.name}' with final input:`, JSON.stringify(inputForTool, null, 2));
    
    let raw_tool_output;
    // Use .invoke() for all tools for consistency.
    raw_tool_output = await toolToExecute.invoke(inputForTool);

    // This is the critical fix: Ensure the output is always a string.
    if (typeof raw_tool_output === 'object' && raw_tool_output !== null) {
        tool_output = JSON.stringify(raw_tool_output, null, 2);
    } else {
        tool_output = raw_tool_output;
    }
  }

  console.log("Final Tool Output:", tool_output);
  return { pastSteps: [{ tool: toolCall.tool, tool_output }] };
};

// 3. Final Responder Node: Synthesizes the final answer.
const responder = async (state) => {
  console.log("---RESPONDER---");
  const responderPrompt = `You are the Final Responder. Your task is to synthesize all the gathered information into a single, comprehensive, and user-friendly response.
  Original Query: ${state.input}
  Gathered Information:
  ${state.pastSteps.map(s => `Step: Executed '${s.tool}'\nResult: ${s.tool_output}`).join("\n\n---\n\n")}
  
  Provide a final, well-structured answer. If there was an error in a previous step, explain the error to the user in a helpful way.`;

  const response = await llm.invoke(responderPrompt);
  return { response: response.content };
};

// --- GRAPH ROUTING LOGIC ---
// This function decides the next step in the workflow.
const router = (state) => {
  console.log("---ROUTER---");
  if (!state.plan || state.plan.includes("PLAN_COMPLETE")) {
    console.log("Decision: Plan is complete. Routing to responder.");
    return "responder";
  } else {
    console.log("Decision: Plan has steps. Routing to tool executor.");
    return "execute_tools";
  }
};

// --- BUILD THE GRAPH ---
const workflow = new StateGraph({ channels: graphState });

workflow.addNode("planner", planner);
workflow.addNode("execute_tools", executeTools);
workflow.addNode("responder", responder);

workflow.addEdge(START, "planner"); // Set the entry point using the new syntax

workflow.addConditionalEdges("planner", router);
// This is the critical change: after executing a tool, go directly to the responder.
workflow.addEdge("execute_tools", "responder"); 
workflow.addEdge("responder", END);

export const app = workflow.compile({ recursionLimit: 50 });
