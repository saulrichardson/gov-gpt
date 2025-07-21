"""Typed Pydantic models that describe the structured output of the LLM.

Only the fields currently consumed by *converter.py* are strictly
required but we capture the full schema so downstream code can start
using it without touching the extractor again.
"""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Param(BaseModel):
    """Description of a single path/query parameter."""

    type: Literal["string", "integer", "number", "boolean", "enum"]
    description: str = ""
    required: bool = False
    enum: Optional[List[str]] = None


class Pagination(BaseModel):
    style: Literal["link", "offset", "cursor", "none"]
    param_names: List[str] = Field(default_factory=list)


class ErrorItem(BaseModel):
    code: int
    meaning: str


class ExtractedSpec(BaseModel):
    method: str
    path: str
    summary: str = ""
    description: str = ""
    auth: Literal["none", "apiKey", "basic", "oauth2"] = "none"
    path_params: Dict[str, Param] = Field(default_factory=dict)
    query_params: Dict[str, Param] = Field(default_factory=dict)
    request_body: Optional[dict] = None
    response: Optional[dict] = None
    pagination: Optional[Pagination] = None
    errors: List[ErrorItem] = Field(default_factory=list)

