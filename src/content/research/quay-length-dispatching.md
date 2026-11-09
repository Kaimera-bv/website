---
title: "Smarter dispatching or shorter drives? What keeps cranes productive on a long quay"
finding: "With straddle carriers assigned to their own crane, optimizing the pickup order changes nothing. On a big terminal, crane rate follows driving distance."
summary: "A simulation of container terminals from 0.3 to 3.5 km of quay. Reordering straddle carrier jobs left the gross crane rate unchanged at every size; stacking discharged boxes near their crane almost doubled it on the longest quay."
date: 2026-11-09
topic: "Terminal simulation"
tags: ["Container terminal", "Straddle carriers", "Dispatching", "Yard planning", "Discrete-event simulation"]
keyNumbers:
  - value: "±0.1"
    label: "GCR change from optimizing the pickup order, at every terminal size"
  - value: "30 → 14"
    label: "GCR from the smallest to the largest terminal, boxes spread over the yard"
  - value: "14 → 27"
    label: "GCR on the 3.5 km quay when discharged boxes stay near their crane"
figure:
  src: "/research/quay-length-dispatching/gcr-by-terminal-size.png"
  alt: "Line chart of gross crane rate against terminal size for three yard layouts. All start near 30 moves per crane per hour on a 0.3 km quay. On the 3.5 km quay the rate is 27 with export and discharged boxes near their crane, 19 with only export boxes near their crane, and 14 with boxes spread over the yard. Orange rings for the optimized pickup order sit on top of every point of the fixed order."
  caption: "Gross crane rate in an 8-hour shift, 3 straddle carriers per crane, mean of 10 runs per point. Orange rings: optimized pickup order. They land on the same spot as the fixed order everywhere. Discharge drive: average loaded drive from crane to yard stack on the 3.5 km quay."
setup:
  - label: "Model"
    value: "terminal-sim, a discrete-event simulation of quay cranes, straddle carriers, buffer lanes and a stacked yard, with traffic between carriers"
  - label: "Shift"
    value: "8 hours, no breaks, more work on the vessel than fits, so no crane runs out of work"
  - label: "Terminal sizes"
    value: "0.3 km / 4 cranes, 0.8 km / 8, 1.6 km / 13, 2.6 km / 19, 3.5 km / 24. Cranes 80 m apart on the smallest quay to about 150 m on the largest"
  - label: "Yard"
    value: "3 blocks deep, widening with the quay, so storage per metre of quay stays the same"
  - label: "Fleet"
    value: "3 straddle carriers per crane, each assigned to one crane; 4 buffer lanes under each crane"
  - label: "Cranes"
    value: "Average cycle 110 s (about 32 moves per hour when never waiting); each crane works bay by bay, discharging first, then loading"
  - label: "Runs"
    value: "10 runs per case, each with its own random vessel and yard; 300 runs in total"
limitations:
  - "The model is not calibrated against a real terminal. Compare the cases with each other, not with your own GCR."
  - "Moving a discharged box later from near its crane to its next vessel's berth is not modelled, so the gain from stacking discharged boxes nearby is an upper limit."
  - "No breaks, gate or landside traffic, crane moves between bays or breakdowns, so gross and net crane time are the same."
  - "Cranes are spread evenly along the quay and work one continuous vessel, rather than several vessels with gaps between berths."
  - "A straddle carrier reserves a buffer lane under its crane as soon as it is assigned, which limits how many export boxes can be under way at once."
draft: false
---

## The question

When a quay gets longer, crane productivity drops: straddle carriers drive further for every box, and the crane waits for them. The usual first answer is more straddle carriers per crane. I'll test that in a later study. This one asks something else: **can you get more out of the same fleet by dispatching it more cleverly?**

I compared two ways of dispatching straddle carriers that are each assigned to one crane:

- **Fixed order.** The carrier takes the next job in its crane's sequence.
- **Optimized order.** The carrier takes the job of its crane with the least slack: the box that would make the crane wait first. For every open job it estimates when the crane needs it and when this carrier could have it there, counting the empty drive, the loaded drive and the pickup and drop times.

I ran both on five terminal sizes and three yard layouts:

- **All boxes spread over the yard.** Boxes go anywhere, within the usual stacking rules (vessel, port, weight).
- **Only export boxes near their crane.** Export boxes are stacked near where their vessel is worked. Discharged boxes go to where their next vessel will berth, or anywhere if they leave by road.
- **Export and discharged boxes near their crane.** As above, and the yard plan keeps 80% of discharged boxes within 400 m driving distance of the crane that lands them.

## What we found

**Optimizing the pickup order changed nothing.** At every terminal size and with every yard layout, the gross crane rate (GCR) of the optimized order was within 0.1 moves per crane per hour of the fixed order.

**Driving distance changed everything.** With boxes spread over the yard, GCR fell from 30 on the smallest terminal to 14 on the largest. On the 3.5 km quay, stacking only export boxes near their crane brought it back to 19. Stacking discharged boxes near their crane too brought it to 27.

| Quay | Cranes | All spread | Only export near crane | Export + discharged near crane |
|---|---|---|---|---|
| 0.3 km | 4 | 30.0 | 29.7 | 29.7 |
| 0.8 km | 8 | 26.7 | 27.9 | 29.8 |
| 1.6 km | 13 | 21.6 | 24.7 | 29.1 |
| 2.6 km | 19 | 17.1 | 21.1 | 27.9 |
| 3.5 km | 24 | 14.3 | 18.6 | 27.1 |

*GCR in moves per crane per hour, fixed pickup order. The optimized order gives the same figures to within 0.1.*

The middle column is the interesting one. Stacking export boxes near their crane cuts their drive to about 290 m at every terminal size, yet on the 3.5 km quay GCR only reaches 19. The discharged boxes are the reason:

| Average loaded drive, 3.5 km quay | Export box | Discharged box |
|---|---|---|
| All spread | 1,454 m | 1,457 m |
| Only export near crane | 288 m | 1,483 m |
| Export + discharged near crane | 290 m | 575 m |

## Why it happens

**There is nothing to reorder.** A carrier assigned to one crane only ever sees a handful of jobs. The crane releases the next three export boxes of its sequence, one fewer than its four buffer lanes, and a carrier reserves a lane as soon as it takes one. Discharge jobs only exist for boxes that have already landed in a lane. With one or two real options, the most urgent job is almost always the next one in the sequence, so both rules pick the same box.

**Discharge drives block loading too.** Each crane works bay by bay, discharging first and then loading. A carrier that drives 1.5 km with a discharged box comes back late for the next one, the lanes under the crane fill up and the crane stops. Loading is held up just as much as discharging, which is why the GCR split between the two stays close to half and half in every layout.

**Small terminals don't care.** On a 300 m quay nothing is far away, so all three yard layouts give a GCR of about 30. The penalty grows with the quay, and so does the gain from short drives.

## What it means for your operation

- If your straddle carriers are assigned to a crane, a smarter job-ordering algorithm is unlikely to raise crane productivity. Spend the effort elsewhere.
- On a long quay, look at where discharged boxes go, not only export boxes. That is where most of the driving is.
- The bigger the terminal, the more the yard plan matters, and the less dispatching can make up for it.

## Next

Two questions follow from this: does adding straddle carriers per crane help on a long quay, and what happens when carriers are no longer tied to one crane, so that dispatching has real choices to make?
