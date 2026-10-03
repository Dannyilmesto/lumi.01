"""Strumenti per l'estrazione conservativa dei contenuti dai listini PDF."""

from .pdf_parser import PDFParseError, PDFParseResult, parse_pdf

__all__ = ['PDFParseError', 'PDFParseResult', 'parse_pdf']
