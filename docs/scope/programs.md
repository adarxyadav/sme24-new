# Programs & tracking · SME24

Part of the [SME24 scope](index.md). The gap report becomes a program run by a matched expert, and progress is tracked in an embedded business intelligence dashboard.

## Slice 6: Match an expert

### 19. Expert matching · needs a decision
AI suggested, human confirmed. From the gap profile, the company's industry, size, region and language, the system ranks available experts using their profiles and shows ops the top suggestions with reasons. Ops confirms one, the client and expert are notified, and the match is recorded so the ranking can be judged later.
**Done when:** ops sees a ranked shortlist with reasons for each released gap report, confirms or overrides the match, and both parties are notified; every confirmed match stores the suggestion and the choice.
- [ ] Design it (spec): `/architect expert matching`

### 20. Program builder & progress updates · needs a decision
The matched expert turns gap findings into a program: workstreams, actions, owners, target dates, and the KPI each action should move. The expert and the client update status and evidence as the program runs. This structured progress data is what the dashboard in Slice 7 reads.
**Done when:** an expert can create a program from the gap findings, the client sees it with status per action, both can update progress with a history, and overdue actions are visible.
- [ ] Design it (spec): `/architect program builder & progress updates`

## Slice 7: Execute and track

### 21. Embedded BI progress dashboard · needs a decision
A Power BI style dashboard embedded in the client dashboard and the expert area, reading program progress and KPI trends from the database, with each client seeing only their own data. Which business intelligence tool to embed, how per client access is mapped, and licensing are the decisions.
**Done when:** a client opens their dashboard and sees an embedded report of program progress and KPI trend that only contains their organization's data, and the same report for an expert covers only their assigned clients; refresh lag is stated on screen.
- [ ] Design it (spec): `/architect embedded BI progress dashboard`
