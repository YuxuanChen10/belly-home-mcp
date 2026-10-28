# Architecture

Tags: #architecture

---

# Overview

## Purpose

> What is Belly Home?

Belly Home is a personal AI infrastructure platform that provides persistent data management, unified tool integration, and domain-based capability management for long-lived AI systems. It separates user data and system capabilities from the underlying language model, enabling the infrastructure to evolve independently of model changes.

---

## Goals

The architecture aims to provide:

- Maintainability
- Scalability
- Extensibility
- Security(1st)
- Long-term evolution

---

# System Structure

## High-Level Architecture

                           AI
                            │
                           MCP
                            │
                        Gateway
                            │
                     Tool Registry
                            │
    ┌────────────┬────────────┬────────────┬────────────┐
    │            │            │            │
 Diary Domain  Document    Desktop      iPhone
                 Domain      Domain      Domain
    │            │            │            │
    │            │            │            │
 Storage     Storage        Storage     Device
 
Document Domain
│
├── read_document()
├── append_document()
├── create_document()
│
└── Document Types
    ├── Architecture
    ├── Design
    ├── Development
    └── Knowledge

Diary Domain ->id
│
├── append_diary()
├── list_diary_entries()
├── read_diary()
└── update_diary()

Desktop Domain -> title
│
├── analyze_desktop()
├── organize_desktop()
└── move()
---
