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


# Some endpoints do not support pagination and the extractor represents that
# by returning `null` for ``pagination.style``.  Relax the type annotation to
# allow ``None`` so we can still parse those endpoints instead of failing the
# whole extraction run.

# NOTE: When ``style`` is omitted entirely we keep the existing behaviour of
# defaulting to the literal string "none" so that downstream code that expects
# a string continues to function without change.


class Pagination(BaseModel):
    style: Optional[Literal["link", "offset", "cursor", "none"]] = "none"
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
