---
name: en-criollo
description: Rewrite a technical finding, answer, or diagnosis as a short plain-language message a non-technical reader can act on, ready to paste into a chat, ticket, or reply. Use it whenever the user asks for something "en criollo", in plain words, for a non-technical audience, or to explain what they just learned to someone else — and proactively when the result of an investigation is clearly headed to a reader who isn't an engineer.
argument-hint: "Who is going to read it? What should it explain?"
---

"En criollo" is Rioplatense for "in plain words". Answer in the language of the conversation — Spanish in, Spanish out.

Lead with the verdict: the first sentence answers the question that started the investigation, bolded when a yes/no is at stake. Then what happened, in two to four sentences, in chronological order only if the sequence actually matters. Close with what it implies or what happens next; "no action needed" is also information.

Translate mechanisms into actions and consequences. Class names, endpoints, queues, tables, queries, commands and stack traces go — they tell the reader the message was not written for them. Keep what they need to act: customer or ticket IDs, amounts, names, and dates with the timezone spelled out when it came from logs. For a message going to an end customer, internal IDs go too.

Claim only what the session actually verified. Where something is a reasonable inference, say so ("I found no record of X, so most likely...") instead of asserting it — this text gets forwarded to customers. If the evidence doesn't support a verdict, say that in the first line and name what's still missing.

Deliver it as short prose in a blockquote, ready to copy. No tables, no headings, no bullet lists. Past eight sentences you are almost certainly including detail the reader doesn't need. Hand over the message alone, with no summary of how you wrote it.

If the user passed arguments, treat them as the audience and what to explain, and calibrate the register and the level of internal detail accordingly. "En criollo" means close and direct, not just jargon-free — default to the informal register (vos/tuteo in Spanish) unless the audience is an external or formal channel.
