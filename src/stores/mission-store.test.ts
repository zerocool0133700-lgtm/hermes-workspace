import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveMissionStoreBeforeUnload, useMissionStore } from './mission-store'
import type { MissionArtifact } from './mission-store'
import type { TeamMember } from '../screens/gateway/components/team-panel'
import type { HubTask } from '../screens/gateway/components/task-board'
import type { MissionCheckpoint } from '../screens/gateway/lib/mission-checkpoint'

const FIXED_NOW = 1_700_000_000_000

function makeTeamMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'agent-1',
    name: 'Atlas',
    modelId: 'opus',
    roleDescription: 'Researcher',
    goal: 'Find facts',
    backstory: 'A diligent researcher',
    status: 'available',
    ...overrides,
  }
}

function makeTask(overrides: Partial<HubTask> = {}): HubTask {
  return {
    id: 'task-1',
    title: 'Do the thing',
    description: 'A description',
    priority: 'normal',
    status: 'inbox',
    agentId: 'agent-1',
    missionId: 'mission-1',
    createdAt: 1_699_000_000_000,
    updatedAt: 1_699_000_000_000,
    ...overrides,
  }
}

function makeArtifact(
  overrides: Partial<MissionArtifact> = {},
): MissionArtifact {
  return {
    id: 'artifact-1',
    agentId: 'agent-1',
    agentName: 'Atlas',
    type: 'text',
    title: 'Report',
    content: 'Some content',
    timestamp: 1_699_000_000_000,
    ...overrides,
  }
}

type StartMissionArg = Parameters<
  ReturnType<typeof useMissionStore.getState>['startMission']
>[0]

function makeMissionInput(
  overrides: Partial<StartMissionArg> = {},
): StartMissionArg {
  return {
    id: 'mission-1',
    goal: 'Build a rocket',
    name: 'Rocket Mission',
    team: [makeTeamMember()],
    tasks: [makeTask()],
    processType: 'sequential',
    budgetLimit: '$100',
    startedAt: 1_699_000_000_000,
    ...overrides,
  }
}

function makeCheckpoint(
  overrides: Partial<MissionCheckpoint> = {},
): MissionCheckpoint {
  return {
    id: 'cp-1',
    label: 'Checkpoint label',
    name: 'Checkpoint name',
    goal: 'Checkpoint goal',
    processType: 'hierarchical',
    team: [
      {
        id: 'agent-9',
        name: 'Cipher',
        modelId: 'sonnet',
        roleDescription: 'Analyst',
        goal: 'Analyze',
        backstory: 'Sharp analyst',
      },
    ],
    tasks: [
      {
        id: 'ct-1',
        title: 'Restored task',
        status: 'in_progress',
        assignedTo: 'agent-9',
      },
    ],
    agentSessionMap: { 'agent-9': 'session-9' },
    status: 'running',
    startedAt: 1_698_000_000_000,
    updatedAt: 1_698_500_000_000,
    budgetLimit: '$50',
    ...overrides,
  }
}

// Snapshot of pristine store data fields so every test starts deterministically.
const PRISTINE = {
  activeMission: null,
  missionActive: false,
  missionGoal: '',
  activeMissionName: '',
  activeMissionGoal: '',
  missionState: 'stopped' as const,
  missionTasks: [],
  boardTasks: [],
  dispatchedTaskIdsByAgent: {},
  agentSessionMap: {},
  agentSessionModelMap: {},
  agentSessionStatus: {},
  artifacts: [],
  restoreCheckpoint: null,
  missionHistory: { reports: [] },
  beforeUnloadRegistered: false,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  useMissionStore.setState(PRISTINE)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mission-store startMission', () => {
  it('starts a mission as running and clones inputs', () => {
    const team = [makeTeamMember()]
    const tasks = [makeTask()]
    useMissionStore.getState().startMission(
      makeMissionInput({
        team,
        tasks,
        plan: [
          {
            title: 'Step 1',
            description: 'desc',
            agent: 'agent-1',
            enabled: true,
          },
        ],
      }),
    )

    const state = useMissionStore.getState()
    const mission = state.activeMission
    expect(mission).not.toBeNull()
    if (!mission) throw new Error('mission expected')

    expect(mission.state).toBe('running')
    expect(state.missionActive).toBe(true)
    expect(state.missionState).toBe('running')
    expect(state.missionGoal).toBe('Build a rocket')
    expect(state.activeMissionName).toBe('Rocket Mission')
    expect(state.activeMissionGoal).toBe('Build a rocket')
    expect(state.missionTasks).toEqual(tasks)

    // Inputs are cloned (defensive copies), not referenced.
    expect(mission.team).not.toBe(team)
    expect(mission.team[0]).not.toBe(team[0])
    expect(mission.tasks).not.toBe(tasks)
    expect(mission.plan?.[0]).toEqual({
      title: 'Step 1',
      description: 'desc',
      agent: 'agent-1',
      enabled: true,
    })
  })

  it('defaults optional session maps and artifacts to empty', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    const mission = useMissionStore.getState().activeMission
    if (!mission) throw new Error('mission expected')
    expect(mission.agentSessionMap).toEqual({})
    expect(mission.agentSessionModelMap).toEqual({})
    expect(mission.agentSessionStatus).toEqual({})
    expect(mission.artifacts).toEqual([])
  })

  it('preserves provided session maps and artifacts', () => {
    useMissionStore.getState().startMission(
      makeMissionInput({
        agentSessionMap: { 'agent-1': 'sess-1' },
        agentSessionModelMap: { 'agent-1': 'opus' },
        agentSessionStatus: {
          'agent-1': { status: 'active', lastSeen: 123 },
        },
        artifacts: [makeArtifact()],
      }),
    )
    const state = useMissionStore.getState()
    expect(state.agentSessionMap).toEqual({ 'agent-1': 'sess-1' })
    expect(state.agentSessionModelMap).toEqual({ 'agent-1': 'opus' })
    expect(state.agentSessionStatus['agent-1']?.status).toBe('active')
    expect(state.artifacts).toHaveLength(1)
  })

  it('sets a restoreCheckpoint snapshot while running', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    const cp = useMissionStore.getState().restoreCheckpoint
    expect(cp).not.toBeNull()
    expect(cp?.id).toBe('mission-1')
    expect(cp?.status).toBe('running')
    expect(cp?.updatedAt).toBe(FIXED_NOW)
  })

  it('clears dispatched task ids on start', () => {
    useMissionStore.setState({
      dispatchedTaskIdsByAgent: { 'agent-1': ['x'] },
    })
    useMissionStore.getState().startMission(makeMissionInput())
    expect(useMissionStore.getState().dispatchedTaskIdsByAgent).toEqual({})
  })
})

describe('mission-store completeMission', () => {
  it('no-ops when there is no active mission', () => {
    const before = useMissionStore.getState()
    before.completeMission()
    const after = useMissionStore.getState()
    expect(after.activeMission).toBeNull()
    expect(after.missionState).toBe('stopped')
  })

  it('marks mission completed, stops it, and archives history', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().completeMission()

    const state = useMissionStore.getState()
    expect(state.activeMission?.state).toBe('completed')
    expect(state.missionActive).toBe(false)
    expect(state.missionState).toBe('stopped')
    expect(state.missionTasks).toEqual([])
    expect(state.dispatchedTaskIdsByAgent).toEqual({})
    expect(state.restoreCheckpoint).toBeNull()
    expect(state.missionHistory.reports).toHaveLength(1)
    expect(state.missionHistory.reports[0]?.status).toBe('completed')
    expect(state.missionHistory.reports[0]?.id).toBe('mission-1')
  })

  it('dedupes history entries by mission id (no duplicate)', () => {
    useMissionStore.setState({
      missionHistory: {
        reports: [makeCheckpoint({ id: 'mission-1', status: 'aborted' })],
      },
    })
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().completeMission()

    const reports = useMissionStore.getState().missionHistory.reports
    expect(reports).toHaveLength(1)
    expect(reports[0]?.status).toBe('completed')
  })

  it('clamps history to the maximum of 20 entries', () => {
    const existing: Array<MissionCheckpoint> = Array.from(
      { length: 25 },
      (_, index) => makeCheckpoint({ id: `old-${index}` }),
    )
    useMissionStore.setState({ missionHistory: { reports: existing } })
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().completeMission()

    const reports = useMissionStore.getState().missionHistory.reports
    expect(reports).toHaveLength(20)
    expect(reports[0]?.id).toBe('mission-1')
  })
})

describe('mission-store abortMission', () => {
  it('no-ops without an active mission', () => {
    useMissionStore.getState().abortMission()
    expect(useMissionStore.getState().activeMission).toBeNull()
  })

  it('marks mission aborted, stops it, and archives history', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().abortMission()

    const state = useMissionStore.getState()
    expect(state.activeMission?.state).toBe('aborted')
    expect(state.missionActive).toBe(false)
    expect(state.missionState).toBe('stopped')
    expect(state.missionHistory.reports[0]?.status).toBe('aborted')
  })
})

describe('mission-store resetMission', () => {
  it('clears all mission fields but keeps history', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().completeMission()
    const historyBefore = useMissionStore.getState().missionHistory

    useMissionStore.getState().resetMission()
    const state = useMissionStore.getState()
    expect(state.activeMission).toBeNull()
    expect(state.missionActive).toBe(false)
    expect(state.missionGoal).toBe('')
    expect(state.activeMissionName).toBe('')
    expect(state.activeMissionGoal).toBe('')
    expect(state.missionState).toBe('stopped')
    expect(state.missionTasks).toEqual([])
    expect(state.boardTasks).toEqual([])
    expect(state.agentSessionMap).toEqual({})
    expect(state.artifacts).toEqual([])
    expect(state.restoreCheckpoint).toBeNull()
    // resetMission does not touch history.
    expect(state.missionHistory).toBe(historyBefore)
  })
})

describe('mission-store updateTaskStatus', () => {
  it('no-ops without an active mission', () => {
    useMissionStore.getState().updateTaskStatus('task-1', 'done')
    expect(useMissionStore.getState().activeMission).toBeNull()
  })

  it('updates a task status and its updatedAt', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().updateTaskStatus('task-1', 'in_progress')

    const task = useMissionStore.getState().missionTasks[0]
    expect(task?.status).toBe('in_progress')
    expect(task?.updatedAt).toBe(FIXED_NOW)
    expect(useMissionStore.getState().activeMission?.tasks[0]?.status).toBe(
      'in_progress',
    )
  })

  it('leaves unrelated tasks untouched and ignores missing ids', () => {
    useMissionStore.getState().startMission(
      makeMissionInput({
        tasks: [
          makeTask({ id: 'task-1', status: 'inbox' }),
          makeTask({ id: 'task-2', status: 'review' }),
        ],
      }),
    )
    useMissionStore.getState().updateTaskStatus('does-not-exist', 'done')
    const tasks = useMissionStore.getState().missionTasks
    expect(tasks[0]?.status).toBe('inbox')
    expect(tasks[1]?.status).toBe('review')
  })

  it('does not bump updatedAt when status is unchanged', () => {
    useMissionStore.getState().startMission(
      makeMissionInput({
        tasks: [makeTask({ id: 'task-1', status: 'inbox', updatedAt: 42 })],
      }),
    )
    useMissionStore.getState().updateTaskStatus('task-1', 'inbox')
    expect(useMissionStore.getState().missionTasks[0]?.updatedAt).toBe(42)
  })
})

describe('mission-store updateAgentStatus', () => {
  it('no-ops without an active mission', () => {
    useMissionStore
      .getState()
      .updateAgentStatus('agent-1', { status: 'active', lastSeen: 1 })
    expect(useMissionStore.getState().activeMission).toBeNull()
  })

  it('sets a status entry', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore
      .getState()
      .updateAgentStatus('agent-1', { status: 'active', lastSeen: 5 })
    expect(useMissionStore.getState().agentSessionStatus['agent-1']).toEqual({
      status: 'active',
      lastSeen: 5,
    })
  })

  it('deletes a status entry when entry is null', () => {
    useMissionStore.getState().startMission(
      makeMissionInput({
        agentSessionStatus: {
          'agent-1': { status: 'active', lastSeen: 5 },
        },
      }),
    )
    useMissionStore.getState().updateAgentStatus('agent-1', null)
    expect(
      useMissionStore.getState().agentSessionStatus['agent-1'],
    ).toBeUndefined()
  })

  it('sets and clears session key via options', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().updateAgentStatus(
      'agent-1',
      { status: 'active', lastSeen: 1 },
      {
        sessionKey: 'sess-1',
      },
    )
    expect(useMissionStore.getState().agentSessionMap['agent-1']).toBe('sess-1')

    useMissionStore.getState().updateAgentStatus(
      'agent-1',
      { status: 'idle', lastSeen: 2 },
      {
        sessionKey: null,
      },
    )
    expect(
      useMissionStore.getState().agentSessionMap['agent-1'],
    ).toBeUndefined()
  })

  it('leaves session map untouched when sessionKey option is omitted', () => {
    useMissionStore
      .getState()
      .startMission(
        makeMissionInput({ agentSessionMap: { 'agent-1': 'keep-me' } }),
      )
    useMissionStore
      .getState()
      .updateAgentStatus('agent-1', { status: 'idle', lastSeen: 2 })
    expect(useMissionStore.getState().agentSessionMap['agent-1']).toBe(
      'keep-me',
    )
  })

  it('sets and clears model via options, ignoring empty strings', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().updateAgentStatus(
      'agent-1',
      { status: 'active', lastSeen: 1 },
      {
        model: 'opus',
      },
    )
    expect(useMissionStore.getState().agentSessionModelMap['agent-1']).toBe(
      'opus',
    )

    // Empty string is ignored (does not overwrite).
    useMissionStore.getState().updateAgentStatus(
      'agent-1',
      { status: 'active', lastSeen: 2 },
      {
        model: '',
      },
    )
    expect(useMissionStore.getState().agentSessionModelMap['agent-1']).toBe(
      'opus',
    )

    // null clears it.
    useMissionStore.getState().updateAgentStatus(
      'agent-1',
      { status: 'active', lastSeen: 3 },
      {
        model: null,
      },
    )
    expect(
      useMissionStore.getState().agentSessionModelMap['agent-1'],
    ).toBeUndefined()
  })
})

describe('mission-store addArtifact', () => {
  it('no-ops without an active mission', () => {
    useMissionStore.getState().addArtifact(makeArtifact())
    expect(useMissionStore.getState().artifacts).toEqual([])
  })

  it('appends a single artifact', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().addArtifact(makeArtifact({ id: 'a1' }))
    expect(useMissionStore.getState().artifacts.map((a) => a.id)).toEqual([
      'a1',
    ])
  })

  it('appends an array of artifacts in order', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore
      .getState()
      .addArtifact([makeArtifact({ id: 'a1' }), makeArtifact({ id: 'a2' })])
    useMissionStore.getState().addArtifact(makeArtifact({ id: 'a3' }))
    expect(useMissionStore.getState().artifacts.map((a) => a.id)).toEqual([
      'a1',
      'a2',
      'a3',
    ])
    expect(
      useMissionStore.getState().activeMission?.artifacts.map((a) => a.id),
    ).toEqual(['a1', 'a2', 'a3'])
  })

  it('no-ops on an empty array', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    const before = useMissionStore.getState().artifacts
    useMissionStore.getState().addArtifact([])
    expect(useMissionStore.getState().artifacts).toBe(before)
  })
})

describe('mission-store setMissionState', () => {
  it('accepts a direct value', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setMissionState('paused')
    const state = useMissionStore.getState()
    expect(state.missionState).toBe('paused')
    expect(state.activeMission?.state).toBe('paused')
  })

  it('accepts an updater function', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore
      .getState()
      .setMissionState((prev) => (prev === 'running' ? 'paused' : 'running'))
    expect(useMissionStore.getState().missionState).toBe('paused')
  })

  it('maps stopped to paused for a non-terminal mission', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setMissionState('stopped')
    expect(useMissionStore.getState().missionState).toBe('stopped')
    expect(useMissionStore.getState().activeMission?.state).toBe('paused')
  })

  it('preserves a terminal aborted state when set to stopped', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().abortMission()
    useMissionStore.getState().setMissionState('stopped')
    expect(useMissionStore.getState().activeMission?.state).toBe('aborted')
  })

  it('preserves a terminal completed state when set to stopped', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().completeMission()
    useMissionStore.getState().setMissionState('stopped')
    expect(useMissionStore.getState().activeMission?.state).toBe('completed')
  })

  it('reflects derived missionActive via syncActiveMission', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setMissionState('paused')
    // paused mission is still "active".
    expect(useMissionStore.getState().missionActive).toBe(true)
  })

  it('works with no active mission (activeMission stays null)', () => {
    useMissionStore.getState().setMissionState('paused')
    expect(useMissionStore.getState().activeMission).toBeNull()
    expect(useMissionStore.getState().missionState).toBe('paused')
  })
})

describe('mission-store restoreMission', () => {
  it('restores an active running mission from a checkpoint', () => {
    useMissionStore.getState().restoreMission(makeCheckpoint())
    const state = useMissionStore.getState()
    const mission = state.activeMission
    if (!mission) throw new Error('mission expected')

    expect(mission.id).toBe('cp-1')
    expect(mission.goal).toBe('Checkpoint goal')
    expect(mission.name).toBe('Checkpoint name')
    expect(mission.state).toBe('running')
    expect(mission.processType).toBe('hierarchical')
    expect(mission.budgetLimit).toBe('$50')
    expect(mission.team[0]?.status).toBe('available')
    expect(mission.agentSessionMap).toEqual({ 'agent-9': 'session-9' })
    expect(state.missionActive).toBe(true)
    expect(state.missionState).toBe('running')
    expect(state.missionTasks).toHaveLength(1)
    expect(state.missionTasks[0]?.status).toBe('in_progress')
    expect(state.missionTasks[0]?.missionId).toBe('cp-1')
  })

  it('restores a paused mission when checkpoint status is paused', () => {
    useMissionStore
      .getState()
      .restoreMission(makeCheckpoint({ status: 'paused' }))
    const state = useMissionStore.getState()
    expect(state.activeMission?.state).toBe('paused')
    expect(state.missionState).toBe('paused')
  })

  it('treats terminal checkpoint statuses as running', () => {
    useMissionStore
      .getState()
      .restoreMission(makeCheckpoint({ status: 'completed' }))
    expect(useMissionStore.getState().activeMission?.state).toBe('running')
  })

  it('falls back to label when name is missing and empty goal', () => {
    useMissionStore.getState().restoreMission(
      makeCheckpoint({
        name: undefined,
        goal: undefined,
        label: 'Just a label',
      }),
    )
    const state = useMissionStore.getState()
    expect(state.activeMission?.name).toBe('Just a label')
    expect(state.activeMission?.goal).toBe('')
    expect(state.missionGoal).toBe('')
  })

  it('prefers agentSessions over agentSessionMap when present', () => {
    useMissionStore.getState().restoreMission(
      makeCheckpoint({
        agentSessionMap: { 'agent-9': 'from-map' },
        agentSessions: { 'agent-9': 'from-sessions' },
      }),
    )
    expect(
      useMissionStore.getState().activeMission?.agentSessionMap['agent-9'],
    ).toBe('from-sessions')
  })

  it('defaults budgetLimit and model map when absent', () => {
    useMissionStore.getState().restoreMission(
      makeCheckpoint({
        budgetLimit: undefined,
        agentSessionModelMap: undefined,
      }),
    )
    const mission = useMissionStore.getState().activeMission
    expect(mission?.budgetLimit).toBe('')
    expect(mission?.agentSessionModelMap).toEqual({})
  })
})

describe('mission-store simple setters', () => {
  it('setMissionGoal sets the goal', () => {
    useMissionStore.getState().setMissionGoal('new goal')
    expect(useMissionStore.getState().missionGoal).toBe('new goal')
  })

  it('setRestoreCheckpoint sets and clears', () => {
    const cp = makeCheckpoint()
    useMissionStore.getState().setRestoreCheckpoint(cp)
    expect(useMissionStore.getState().restoreCheckpoint).toBe(cp)
    useMissionStore.getState().setRestoreCheckpoint(null)
    expect(useMissionStore.getState().restoreCheckpoint).toBeNull()
  })

  it('markBeforeUnloadRegistered toggles the flag', () => {
    useMissionStore.getState().markBeforeUnloadRegistered(true)
    expect(useMissionStore.getState().beforeUnloadRegistered).toBe(true)
    useMissionStore.getState().markBeforeUnloadRegistered(false)
    expect(useMissionStore.getState().beforeUnloadRegistered).toBe(false)
  })

  it('setBoardTasks accepts a value and an updater', () => {
    const tasks = [makeTask({ id: 'b1' })]
    useMissionStore.getState().setBoardTasks(tasks)
    expect(useMissionStore.getState().boardTasks).toEqual(tasks)
    useMissionStore
      .getState()
      .setBoardTasks((prev) => [...prev, makeTask({ id: 'b2' })])
    expect(useMissionStore.getState().boardTasks.map((t) => t.id)).toEqual([
      'b1',
      'b2',
    ])
  })

  it('setDispatchedTaskIdsByAgent accepts a value and an updater', () => {
    useMissionStore
      .getState()
      .setDispatchedTaskIdsByAgent({ 'agent-1': ['t1'] })
    expect(
      useMissionStore.getState().dispatchedTaskIdsByAgent['agent-1'],
    ).toEqual(['t1'])
    useMissionStore.getState().setDispatchedTaskIdsByAgent((prev) => ({
      ...prev,
      'agent-2': ['t2'],
    }))
    expect(
      useMissionStore.getState().dispatchedTaskIdsByAgent['agent-2'],
    ).toEqual(['t2'])
  })
})

describe('mission-store mission-bound setters', () => {
  it('setMissionTasks updates both mirror and active mission when active', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    const next: Array<HubTask> = [makeTask({ id: 'task-9', status: 'done' })]
    useMissionStore.getState().setMissionTasks(next)
    expect(useMissionStore.getState().missionTasks).toEqual(next)
    expect(useMissionStore.getState().activeMission?.tasks).toEqual(next)
  })

  it('setMissionTasks leaves activeMission null when none active (updater form)', () => {
    useMissionStore
      .getState()
      .setMissionTasks((prev) => [...prev, makeTask({ id: 'task-x' })])
    expect(useMissionStore.getState().activeMission).toBeNull()
    expect(useMissionStore.getState().missionTasks.map((t) => t.id)).toEqual([
      'task-x',
    ])
  })

  it('setAgentSessionMap updates mirror and active mission', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setAgentSessionMap({ 'agent-1': 's' })
    expect(useMissionStore.getState().agentSessionMap).toEqual({
      'agent-1': 's',
    })
    expect(useMissionStore.getState().activeMission?.agentSessionMap).toEqual({
      'agent-1': 's',
    })
  })

  it('setAgentSessionMap works (updater) with no active mission', () => {
    useMissionStore.getState().setAgentSessionMap((prev) => ({
      ...prev,
      x: 'y',
    }))
    expect(useMissionStore.getState().agentSessionMap).toEqual({ x: 'y' })
    expect(useMissionStore.getState().activeMission).toBeNull()
  })

  it('setAgentSessionModelMap updates mirror and active mission', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setAgentSessionModelMap({ 'agent-1': 'opus' })
    expect(useMissionStore.getState().agentSessionModelMap).toEqual({
      'agent-1': 'opus',
    })
    expect(
      useMissionStore.getState().activeMission?.agentSessionModelMap,
    ).toEqual({ 'agent-1': 'opus' })
  })

  it('setAgentSessionStatus updates mirror and active mission', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setAgentSessionStatus({
      'agent-1': { status: 'error', lastSeen: 9 },
    })
    expect(
      useMissionStore.getState().agentSessionStatus['agent-1']?.status,
    ).toBe('error')
    expect(
      useMissionStore.getState().activeMission?.agentSessionStatus['agent-1']
        ?.status,
    ).toBe('error')
  })

  it('setArtifacts replaces artifacts on mirror and active mission', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    const arts = [makeArtifact({ id: 'z1' })]
    useMissionStore.getState().setArtifacts(arts)
    expect(useMissionStore.getState().artifacts).toEqual(arts)
    expect(useMissionStore.getState().activeMission?.artifacts).toEqual(arts)
  })
})

describe('mission-store setActiveMissionMeta', () => {
  it('updates mirror fields when no active mission, preserving omitted values', () => {
    useMissionStore.setState({
      activeMissionName: 'old name',
      activeMissionGoal: 'old goal',
    })
    useMissionStore.getState().setActiveMissionMeta({ name: 'new name' })
    const state = useMissionStore.getState()
    expect(state.activeMissionName).toBe('new name')
    expect(state.activeMissionGoal).toBe('old goal')
  })

  it('updates both active mission and mirror fields', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore
      .getState()
      .setActiveMissionMeta({ name: 'Renamed', goal: 'New goal' })
    const state = useMissionStore.getState()
    expect(state.activeMission?.name).toBe('Renamed')
    expect(state.activeMission?.goal).toBe('New goal')
    expect(state.activeMissionName).toBe('Renamed')
    expect(state.activeMissionGoal).toBe('New goal')
  })

  it('keeps existing mission name/goal when omitted', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setActiveMissionMeta({ goal: 'Only goal' })
    const state = useMissionStore.getState()
    expect(state.activeMission?.name).toBe('Rocket Mission')
    expect(state.activeMission?.goal).toBe('Only goal')
  })
})

describe('mission-store saveCheckpoint', () => {
  it('no-ops without an active mission', () => {
    useMissionStore.getState().saveCheckpoint()
    expect(useMissionStore.getState().restoreCheckpoint).toBeNull()
  })

  it('stores a checkpoint built from the active mission', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    // Clear it first, then re-save to prove saveCheckpoint repopulates.
    useMissionStore.setState({ restoreCheckpoint: null })
    useMissionStore.getState().saveCheckpoint()
    const cp = useMissionStore.getState().restoreCheckpoint
    expect(cp?.id).toBe('mission-1')
    expect(cp?.name).toBe('Rocket Mission')
    expect(cp?.goal).toBe('Build a rocket')
    expect(cp?.label).toBe('Rocket Mission')
  })

  it('falls back through name -> goal -> Untitled for the label', () => {
    useMissionStore
      .getState()
      .startMission(makeMissionInput({ name: '', goal: '' }))
    useMissionStore.getState().saveCheckpoint()
    expect(useMissionStore.getState().restoreCheckpoint?.label).toBe(
      'Untitled mission',
    )
  })
})

describe('mission-store buildCheckpoint mapping (via saveCheckpoint)', () => {
  it('maps team, tasks, and session maps into the checkpoint', () => {
    useMissionStore.getState().startMission(
      makeMissionInput({
        team: [makeTeamMember({ id: 'm1', name: 'Forge' })],
        tasks: [
          makeTask({
            id: 't1',
            title: 'Task one',
            status: 'review',
            agentId: 'm1',
          }),
        ],
        agentSessionMap: { m1: 'sess' },
        agentSessionModelMap: { m1: 'opus' },
      }),
    )
    useMissionStore.getState().saveCheckpoint()
    const cp = useMissionStore.getState().restoreCheckpoint
    if (!cp) throw new Error('checkpoint expected')

    expect(cp.team[0]).toEqual({
      id: 'm1',
      name: 'Forge',
      modelId: 'opus',
      roleDescription: 'Researcher',
      goal: 'Find facts',
      backstory: 'A diligent researcher',
    })
    expect(cp.tasks[0]).toEqual({
      id: 't1',
      title: 'Task one',
      status: 'review',
      assignedTo: 'm1',
    })
    expect(cp.agentSessionMap).toEqual({ m1: 'sess' })
    expect(cp.agentSessions).toEqual({ m1: 'sess' })
    expect(cp.agentSessionModelMap).toEqual({ m1: 'opus' })
    expect(cp.processType).toBe('sequential')
  })
})

describe('saveMissionStoreBeforeUnload', () => {
  it('does nothing when mission is not running', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.getState().setMissionState('paused')
    useMissionStore.setState({ restoreCheckpoint: null })
    saveMissionStoreBeforeUnload()
    expect(useMissionStore.getState().restoreCheckpoint).toBeNull()
  })

  it('saves a checkpoint when mission is running', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    useMissionStore.setState({ restoreCheckpoint: null })
    saveMissionStoreBeforeUnload()
    expect(useMissionStore.getState().restoreCheckpoint?.id).toBe('mission-1')
  })
})

describe('mission-store updateCheckpointSnapshot branch', () => {
  it('nulls restoreCheckpoint when missionState is stopped', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    expect(useMissionStore.getState().restoreCheckpoint).not.toBeNull()
    // updateTaskStatus runs updateCheckpointSnapshot; with stopped state it nulls.
    useMissionStore.setState({ missionState: 'stopped' })
    useMissionStore.getState().updateTaskStatus('task-1', 'done')
    expect(useMissionStore.getState().restoreCheckpoint).toBeNull()
  })

  it('keeps a snapshot when running and rebuilds on task update', () => {
    useMissionStore.getState().startMission(makeMissionInput())
    vi.setSystemTime(FIXED_NOW + 1000)
    useMissionStore.getState().updateTaskStatus('task-1', 'done')
    const cp = useMissionStore.getState().restoreCheckpoint
    expect(cp?.updatedAt).toBe(FIXED_NOW + 1000)
    expect(cp?.tasks[0]?.status).toBe('done')
  })
})
