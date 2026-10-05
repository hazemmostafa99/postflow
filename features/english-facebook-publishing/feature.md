# Arabic and English Facebook Publishing

## Goal

Allow the PostFlow Chrome extension to publish reliably when Facebook is shown
in either Arabic or English, while preserving the current Arabic publishing
behavior.

This feature is additive:

```text
Existing Arabic Facebook publishing
                +
New English Facebook publishing support
                =
One shared locale-aware publishing flow
```

The language of the Facebook interface is independent from the language of the
post content. A user may publish Arabic content from an English Facebook UI or
English content from an Arabic Facebook UI.

---

## Existing-System Rule

Extend the current extension publishing flow. Do not create a second English
queue, a second content script, or a separate English publishing engine.

Preserve:

- the current Arabic phrases and successful Arabic paths
- the existing Group and Profile Feed target behavior
- the current job claiming, scheduling, cancellation, and queue protections
- the existing account and destination identity checks
- the current media upload and post-tracking architecture
- existing support for Facebook response and permalink evidence

English support must be introduced through shared locale-aware discovery and
detection helpers.

---

## Mandatory Collaboration Rule

The Arabic and English Facebook interfaces must be treated as different DOM and
behavior variants. Similar labels do not imply identical containers,
attributes, nesting, timing, dialogs, or submission behavior.

Before implementing or changing anything that depends on Facebook DOM or
runtime behavior, stop and ask the user for the relevant input. Depending on
the step, that input may include:

- the Arabic and/or English DOM snippet
- a screenshot or screen recording
- the visible labels and current Facebook UI language
- the URL shape and publishing target
- the observed behavior before and after a click
- console diagnostics from a controlled manual attempt

Do not guess an English selector from the Arabic DOM, and do not rewrite the
working Arabic path based only on an English sample.

After each DOM- or behavior-dependent change, ask the user to check the flow
manually and report the result before marking that step complete or continuing
to another Facebook surface.

Automated DOM fixture work is deferred for now. Existing repository tests must
not be deleted, but adding or expanding automated tests is not part of this
feature's current execution plan unless the user requests it later.

---

## Problem Statement

The extension already contains some English labels, but localized Facebook UI
text is spread across composer discovery, submit-button selection, media
attachment, result detection, pending approval, interruption detection, and
engagement extraction.

Some fallbacks are also broad enough to select a generic Facebook button. A
layout difference between the Arabic and English Facebook interfaces can
therefore cause the extension to miss the correct control or click the wrong
one.

The feature must make English a manually validated, supported locale without
weakening the working Arabic flow.

---

## Scope

The first release must support Arabic and English Facebook interfaces for:

- Facebook Group publishing
- Profile Feed publishing
- text-only posts
- image posts
- video posts
- immediate and scheduled jobs
- composer discovery
- text editor discovery and content insertion
- media input and preview detection
- final Post button discovery
- successful publication detection
- pending-approval detection for Group posts
- Facebook failure and interruption detection
- published-post and permalink tracking
- reaction and comment extraction

The extension should continue to work when Facebook renders a mixed-language
surface, such as an English page containing an Arabic notification.

---

## Non-Goals

- translating the PostFlow website
- translating user-authored post content
- machine translation of posts
- adding a required language field to Post, PublishingJob, Group, or
  FacebookConnection
- maintaining separate Arabic and English publishing queues
- guaranteeing support for every Facebook locale
- redesigning scheduling, retries, job leasing, or account routing
- replacing reliable URL, DOM-structure, or Facebook-response evidence with
  text matching
- removing the existing French or Portuguese fallbacks while doing this work

---

## Terminology

### Facebook UI locale

The language used by Facebook for labels such as `Write something`, `Post`,
success messages, and error dialogs.

### Post content language

The language of the text supplied by the PostFlow user. It must not control
which Facebook UI selectors are enabled.

### Locale catalog

A centralized collection of known Arabic and English phrases grouped by their
semantic purpose.

### Structural signal

A language-independent Facebook DOM or network characteristic, such as a
`data-pagelet`, ARIA role, Lexical editor attribute, file input type, permalink,
or accepted publishing response.

---

## Current-State Findings

The extension already has partial bilingual support:

- Group composer discovery includes Arabic and English phrases.
- Profile composer discovery includes Arabic and English phrases.
- Post-button discovery includes an English `Post` label and an Arabic label.
- success, pending approval, and interruption detection include both languages
  in several places
- engagement extraction recognizes English and Arabic action labels

The main gaps are architectural:

- phrases are duplicated or embedded directly in workflow functions
- different detectors use different normalization rules
- several generic button fallbacks are not sufficiently constrained
- the Arabic and English Facebook surfaces may use different DOM structures and
  behavior
- current English DOM and behavior evidence must be supplied by the user before
  selector changes are designed
- mixed-language behavior is not an explicit validated contract

---

## Architecture

### One publishing engine

Both locales must use the same workflow:

```text
validate target
    -> find composer
        -> find editor
            -> insert content
                -> attach media when present
                    -> find submit control
                        -> submit once
                            -> classify result
                                -> track permalink and engagement
```

Only the localized evidence catalog differs.

### Centralized locale catalog

Introduce one extension-owned catalog organized by semantic key rather than by
workflow file.

Conceptual shape:

```ts
type SupportedFacebookLocale = "ar" | "en";

interface FacebookLocaleCatalog {
  composerTriggers: string[];
  postOptions: string[];
  submitLabels: string[];
  mediaLabels: string[];
  mediaPreviewLabels: string[];
  publishSuccess: string[];
  publishFailure: string[];
  videoProcessing: string[];
  pendingApproval: string[];
  temporaryBlock: string[];
  securityChallenge: string[];
  identityVerification: string[];
  reactionLabels: string[];
  commentLabels: string[];
  noComments: string[];
}
```

The exact module structure may differ, but all publishing detectors should
consume the same catalog and normalization utilities.

### Locale selection

`document.documentElement.lang` may be used as a preference or diagnostic hint,
but it must not disable the other supported locale.

Resolution rule:

```text
1. Prefer language-independent structural evidence.
2. Prefer phrases matching the detected Facebook UI locale.
3. Fall back to all supported Arabic and English phrases.
4. Fail safely when the target control remains ambiguous.
```

This supports Facebook pages that contain mixed-language or gradually hydrated
content.

No user-facing locale selector is required for the first release. A diagnostic
override may be added for testing, but normal publishing should use automatic
resolution.

---

## Text Normalization

All localized matching must use one shared normalization contract:

- Unicode NFKC normalization
- lowercase comparison where applicable
- whitespace collapsing
- Arabic diacritic and tatweel removal
- safe normalization of common Arabic letter variants where it does not create
  unacceptable false positives
- preservation of letters and numbers needed for English matching

Mojibake strings must not be treated as the primary production contract. If a
legacy malformed string must remain temporarily for compatibility, document it
and ask the user to verify the affected flow manually.

---

## Element Resolution Strategy

### General priority

Resolvers should use the following order:

1. destination-specific and composer-specific containers
2. semantic or stable attributes
3. localized labels within the correct container
4. scored, constrained fallback candidates
5. safe failure with diagnostics

Do not select the first generic `role="button"` candidate solely because its
text is short.

The final resolver for each surface must be based on user-supplied DOM evidence
for that locale. Shared structural selectors may be used only after confirming
that they are present and semantically equivalent in both supplied variants.

### Candidate scoring

When more than one candidate exists, score positive and negative signals.

Positive examples:

- inside the active composer
- exact normalized label match
- expected ARIA role
- visible and enabled
- near the active editor
- inside `GroupInlineComposer` or `ProfileComposer`

Negative examples:

- inside an existing feed article
- inside a Story, Reel, audience, privacy, or navigation control
- hidden or disabled
- outside the active destination surface
- ambiguous with another equally strong candidate

If the best candidate is not unambiguous, the extension must stop before the
final click and report diagnostics.

---

## Composer Discovery

### Group composer

Prefer the Group composer pagelet and structural editor signals. Arabic and
English trigger phrases are fallback evidence inside the Group page's main
surface.

The resolver must not choose a button inside an existing post article.

### Profile composer

Continue to require the expected canonical profile URL and verified Facebook
identity. Search the Profile composer surface first and reject Story, Reel,
audience, privacy, and existing-post controls in both locales.

### Intermediate creation dialog

If Facebook shows a `What do you want to create?`-style dialog, identify the
Post/Text option through structure plus the locale catalog. Do not treat any
button containing a broad word such as `post` as sufficient without checking
its dialog and destination context.

---

## Editor and Content Insertion

Editor discovery should remain language-independent wherever possible:

- `data-lexical-editor="true"`
- `role="textbox"`
- `contenteditable="true"`
- `textarea`

Content insertion must support Arabic, English, mixed-direction text, numbers,
emoji, punctuation, and line breaks.

After insertion, verify that the editor contains the expected normalized
content or a reliable equivalent signal before continuing. Do not infer success
only because an insertion API returned `true`.

---

## Submit Button Safety

The final Facebook Post control is the highest-risk localized action.

Requirements:

- search only within the active composer surface
- require the control to be visible and enabled
- prefer an exact normalized Arabic or English submit label
- combine text, `aria-label`, role, and proximity to the active editor
- reject media, audience, privacy, cancel, back, and navigation controls
- fail safely if more than one candidate is equally plausible
- re-verify the expected Facebook account and destination immediately before
  clicking
- preserve the existing single-submit and cancellation protections

---

## Media Support

Prefer an existing compatible `input[type="file"]` over localized buttons.

If a media control must be clicked, use Arabic and English media labels from the
catalog and keep the search within the active composer.

Media attachment confirmation should prioritize:

- selected file input state
- blob or data preview sources
- rendered image or video elements
- locale-aware preview labels as fallback evidence

---

## Submission Result Classification

Result classification must combine independent evidence:

- Facebook publishing response data
- a new target-owned permalink
- a new matching post absent from the pre-submit snapshot
- a pending-approval surface
- a visible success message
- composer acceptance or closure when allowed by the existing target-specific
  rules
- explicit failure or interruption surfaces

Arabic and English phrases should be data supplied to shared detectors. The
state machine and result types must remain locale-independent.

Do not mark a job published only because a generic localized word such as
`published` appears somewhere in the page.

---

## Pending Approval and Interruption Detection

Preserve all current Arabic phrases and add or verify equivalent English
coverage for:

- pending admin approval
- moderator review
- temporary posting blocks
- CAPTCHA or security challenges
- checkpoint and identity verification
- login requirements
- generic publish failures

Only visible semantic surfaces associated with the current publishing attempt
may provide this evidence.

Queue-pausing behavior must remain identical across Arabic and English for the
same interruption category.

---

## Published-Post Tracking and Engagement

URL identity, post IDs, timestamps, pre-submit snapshots, and network evidence
remain the primary tracking mechanisms and must not depend on language.

When an English Pending Posts card exposes matched content but no permalink or
stable post ID in the rendered DOM, a page-start network observer may inspect
the pending-feed GraphQL response. It must match the submitted post exactly,
validate the Group identity, retain no response body, and log only candidate
counts and the resolved URL. This fallback must be scoped to the English
pending-approval lookup and must not change the working Arabic submission or
URL-capture path.

Localized text is permitted for:

- reaction and Like labels
- comment labels
- explicit zero-comment messages

Arabic and English counters must use the same numeric parsing and result model.
Arabic-Indic and Western digits must remain supported.

---

## Diagnostics

For every locale-sensitive resolution step, record enough information to debug
a failure without storing full post content:

- detected document locale
- target type
- resolver step
- structural selector used
- matched locale and semantic key
- candidate count
- selected candidate label truncated to a safe length
- rejection reason or ambiguity reason

Diagnostics must not log authentication tokens, cookies, full page HTML, or
complete user-authored post content.

---

## Manual Validation Strategy

### Evidence-first rule

Record the currently working Arabic behavior before changing shared resolver
behavior. Obtain the corresponding English DOM and observed behavior from the
user before implementing English support for that surface.

### Required checkpoints

Handle one surface at a time. For each item below:

1. Ask the user for the relevant Arabic or English DOM and behavior input.
2. Inspect that input without assuming parity with the other locale.
3. Make only the scoped change supported by the supplied evidence.
4. Ask the user to run the matching manual check.
5. Record the user-reported result in `progress.md`.
6. Continue only after the status is known.

Required manual checkpoints include:

- Group composer trigger
- Profile composer trigger
- intermediate Post/Text option
- editor discovery and content insertion
- final submit button
- image attachment and preview
- video attachment, processing, and completion
- success and failure messages
- pending approval
- temporary block, challenge, verification, and login interruptions
- published-post matching
- reaction, comment, and zero-comment extraction

### Manual check matrix

| Facebook UI | Target       | Content              | Media | Expected result |
| ----------- | ------------ | -------------------- | ----- | --------------- |
| Arabic      | Group        | Arabic               | None  | Publish once    |
| Arabic      | Group        | English              | Image | Publish once    |
| Arabic      | Profile Feed | Mixed Arabic/English | Video | Publish once or safe uncertain result |
| English     | Group        | English              | None  | Publish once    |
| English     | Group        | Arabic               | Image | Publish once    |
| English     | Profile Feed | Mixed Arabic/English | Video | Publish once or safe uncertain result |

For Groups, repeat applicable cases with immediate publication and admin
approval enabled.

---

## Rollout

1. Ask the user to confirm the current Arabic baseline manually.
2. Ask for the English DOM and observed behavior for the first selected surface.
3. Make one evidence-backed, surface-specific change.
4. Ask the user to validate that English surface manually.
5. Ask the user to recheck the corresponding Arabic behavior.
6. Record both reported statuses before moving to the next surface.
7. Expand incrementally to text, image, and video for Group and Profile Feed
   targets.
8. Remove any temporary rollout flag only after the user confirms both locale
   matrices.

If English behavior fails ambiguously, fail before clicking Post and keep the
job retry-safe. Never fall back to an unverified generic button.

---

## Acceptance Criteria

The feature is complete when:

- existing Arabic publishing behavior remains operational
- English Facebook UI publishing works for Group and Profile Feed targets
- Arabic, English, and mixed-language post content can be inserted regardless
  of the Facebook UI locale
- the user confirms the text, image, and video paths in the defined manual check
  matrix
- pending approval and interruption categories behave consistently in both
  locales
- submit-button resolution never relies on an unconstrained generic-button
  fallback
- ambiguous controls cause a safe failure before submission
- published-post tracking and engagement extraction work in both locales
- every DOM- or behavior-dependent change is based on input requested from the
  user rather than assumed cross-locale parity
- manual Arabic and English checks are reported by the user and recorded
- no API or database language field is required for normal operation
