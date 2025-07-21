Public-Spending Gateway
=======================

A backend control-plane service that lets large language models pose natural-language queries to live public-spending datasets (e.g., USAspending.gov). It turns your question into REST API calls, fetches fresh JSON, and feeds it straight back to the model


Why?
----

• Public-spending APIs are open but fragmented and documentation-heavy.  
• LLMs excel at explanation yet struggle with up-to-date numbers.  
• A thin **live tool interface** combines the two: conversational
  answers backed by current figures and clear citations.


How it works (high level)
------------------------

1. **Documentation extraction** – An LLM parses Markdown / YAML specs
   (see `usaspending-api/`) and distils each endpoint’s method, path,
   parameters and response shape.
2. **Schema catalog** – The structured output is stored in an SQLite
   file (`sections.db`) so incremental updates are cheap.
3. **Tool generation** – For every catalog entry we create both:
     a. an OpenAI-style JSON schema the chat model can call, and  
     b. a Python callable that knows how to hit the live endpoint.
4. **Runtime orchestration** – The server exposes those schemas to the
   chat model. Whenever the model returns a tool invocation, the backend
   executes it, streams back the JSON and finally lets the model craft a
   natural-language reply quoting the data.


Repo layout
-----------

```
.
├── llm_pipeline/     # extraction, conversion & execution logic
├── usaspending-api/  # mirrored source documentation (sample dataset)
├── sections.db       # generated SQLite catalog of parsed docs
└── README.md         # you are here
```




Roadmap
-------

• Expose the project as an **MCP server** via a so any LLM front-end can make function calls
to poll up to date data.

• Automatic repair of malformed API calls emitted by the model and self-documenating agents that learn which end points to hit for 
certain nautral language questions.

• Support for additional open-spending datasets beyond USAspending.
