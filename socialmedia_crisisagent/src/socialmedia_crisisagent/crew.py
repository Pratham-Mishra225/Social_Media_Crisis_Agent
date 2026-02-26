import os
from crewai import Agent, Crew, Process, Task, LLM
from crewai.project import CrewBase, agent, crew, task
from crewai.agents.agent_builder.base_agent import BaseAgent
from typing import List
from dotenv import load_dotenv

from socialmedia_crisisagent.tools.feed_reader import FeedReaderTool
from socialmedia_crisisagent.tools.response_logger import ResponseLoggerTool

load_dotenv()


def get_gemini_llm():
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    return LLM(
        model="gemini/gemini-2.0-flash-lite",
        api_key=key,
    )


def get_groq_llm():
    key = os.getenv("GROQ_API_KEY")
    if not key or key == "your_groq_api_key_here":
        return None
    return LLM(
        model="groq/llama-3.3-70b-versatile",  # ✅ official replacement per Groq docs
        api_key=key,
    )


def get_llm() -> LLM:
    gemini = get_gemini_llm()
    groq = get_groq_llm()

    if gemini:
        print("✅ Primary: Gemini gemini-2.0-flash-lite")
        return gemini
    elif groq:
        print("✅ Fallback: Groq llama-3.3-70b-versatile")
        return groq
    else:
        raise ValueError(
            "No LLM available. Set GEMINI_API_KEY or GROQ_API_KEY in .env"
        )


# Single instance reused across all agents
llm = get_llm()


@CrewBase
class SocialmediaCrisisagent():
    """Social Media Crisis Response Crew"""

    agents: List[BaseAgent]
    tasks: List[Task]

    @agent
    def monitor_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['monitor_agent'],
            tools=[FeedReaderTool()],
            llm=llm,
            verbose=True
        )

    @agent
    def severity_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['severity_agent'],
            llm=llm,
            verbose=True
        )

    @agent
    def strategy_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['strategy_agent'],
            llm=llm,
            verbose=True
        )

    @agent
    def drafter_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['drafter_agent'],
            # ✅ No tools — drafter just writes, output_file saves it
            llm=llm,
            verbose=True
        )   

    @agent
    def feedback_agent(self) -> Agent:
        return Agent(
            config=self.agents_config['feedback_agent'],
            llm=llm,
            verbose=True
        )

    @task
    def monitor_task(self) -> Task:
        return Task(config=self.tasks_config['monitor_task'])

    @task
    def severity_task(self) -> Task:
        return Task(config=self.tasks_config['severity_task'])

    @task
    def strategy_task(self) -> Task:
        return Task(config=self.tasks_config['strategy_task'])

    @task
    def drafter_task(self) -> Task:
        return Task(config=self.tasks_config['drafter_task'])

    @task
    def feedback_task(self) -> Task:
        return Task(
            config=self.tasks_config['feedback_task'],
            output_file='report.md'
        )

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=True,
        )