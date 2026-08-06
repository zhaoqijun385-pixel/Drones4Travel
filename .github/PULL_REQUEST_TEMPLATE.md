## Summary

<!-- What does this PR do? One or two sentences is enough. -->

## Related Issue

<!-- Link the issue this PR closes, if any: Closes #123 -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code cleanup
- [ ] Documentation
- [ ] Performance
- [ ] CI / tooling

## Safety Impact (for drone-control changes)

<!-- If this PR touches crazyflie_bridge, drone_commands, fleet control,
     motion control, or the e-stop chain, check all that apply: -->

- [ ] No drone-control changes — skip this section.
- [ ] Sim-only tested (`CF_NO_FLY=1` or fleet_simulator)
- [ ] Bench tested (no propellers / safety rig)
- [ ] Low-altitude flight tested
- [ ] Multi-drone tested
- [ ] Safety note added below:

**Safety notes (if applicable):**

<!-- Describe any new safety invariants, changed defaults, or rollback steps. -->

## Test Plan

<!-- How did you verify this change? Commands, browser steps, etc. -->

- [ ] `npm run test:fleet` passes
- [ ] `npm run build` passes
- [ ] `python -m unittest discover server/tests -v` passes
- [ ] Manual browser check at `http://localhost:5173`

## Screenshots (if UI change)

<!-- Drag-and-drop or paste screenshots here. -->
