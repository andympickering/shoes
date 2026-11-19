"""Shared helpers for searching active alert terms."""
from .rss_discovery import SupabaseRest


def alert_terms(expression: str) -> list[str]:
    """Extract search operands using the alert parser's quoting rules."""
    terms = []
    index = 0
    while index < len(expression):
        if expression[index].isspace() or expression[index] in "()":
            index += 1
            continue
        if expression[index] == '"':
            index += 1
            value = ""
            while index < len(expression) and expression[index] != '"':
                if expression[index] == "\\" and index + 1 < len(expression):
                    index += 1
                value += expression[index]
                index += 1
            if index == len(expression):
                raise ValueError("Unclosed quotation mark in alert expression")
            index += 1
            if not value.strip():
                raise ValueError("Empty quoted alert term")
            terms.append(value)
        else:
            start = index
            while index < len(expression) and not expression[index].isspace() and expression[index] not in "()":
                index += 1
            value = expression[start:index]
            if value.lower() not in ("and", "or"):
                terms.append(value)
    if not terms:
        raise ValueError("Alert expression has no search terms")
    return terms


def active_alert_terms(supabase: SupabaseRest) -> list[str]:
    terms: dict[str, None] = {}
    offset = 0
    page_size = 500
    while True:
        rows = supabase.request(
            "GET",
            "chnscraping_alert_subscriptions",
            params={
                "select": "id,search_terms",
                "active": "eq.true",
                "order": "id.asc",
                "limit": str(page_size),
                "offset": str(offset),
            },
        )
        for row in rows:
            for term in alert_terms(row["search_terms"]):
                terms.setdefault(term, None)
        if len(rows) < page_size:
            return list(terms)
        offset += len(rows)
