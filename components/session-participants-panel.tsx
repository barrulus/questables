import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "./ui/utils";
import { Check, ChevronsUpDown, Loader2, RefreshCw, Trash2, UserPlus } from "lucide-react";

interface SessionParticipant {
  id: string;
  session_id: string;
  user_id: string;
  character_id: string;
  character_name: string;
  username: string;
  character_level_start: number;
  character_level_end: number;
  attendance_status: 'present' | 'absent' | 'late' | 'left_early';
}

interface CampaignMember {
  id: string;
  campaign_player_id: string | null;
  user_id: string;
  username: string;
  character_id: string | null;
  character_name: string | null;
  character_level: number | null;
  role: 'player' | 'co-dm';
}

const ATTENDANCE_OPTIONS: readonly SessionParticipant['attendance_status'][] = [
  'present', 'absent', 'late', 'left_early',
];

const formatAttendanceLabel = (value: SessionParticipant['attendance_status']): string =>
  value.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

interface ParticipantDraft {
  attendance: SessionParticipant['attendance_status'];
  level: number;
}

interface SessionParticipantsPanelProps {
  participants: SessionParticipant[];
  participantsLoading: boolean;
  participantsError: string | null;
  participantDrafts: Record<string, ParticipantDraft>;
  canMutate: boolean;
  updatingParticipantId: string | null;
  removingParticipantId: string | null;
  onAttendanceChange: (participantId: string, value: SessionParticipant['attendance_status']) => void;
  onLevelChange: (participantId: string, value: number) => void;
  onSaveParticipant: (participantId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  // Add participant form
  unusedMembers: CampaignMember[];
  selectedMember: CampaignMember | null;
  selectedMemberId: string;
  onMemberSelect: (id: string) => void;
  memberPickerOpen: boolean;
  onMemberPickerOpenChange: (open: boolean) => void;
  membersLoading: boolean;
  membersError: string | null;
  onRefreshRoster: () => void;
  selectedAttendance: SessionParticipant['attendance_status'];
  onSelectedAttendanceChange: (value: SessionParticipant['attendance_status']) => void;
  selectedLevel: number;
  onSelectedLevelChange: (value: number) => void;
  selectedCharacterId: string;
  participantBusy: boolean;
  hasSelectedSession: boolean;
  onAddParticipant: () => void;
}

export type { SessionParticipant, CampaignMember };

export function SessionParticipantsPanel({
  participants, participantsLoading, participantsError,
  participantDrafts, canMutate,
  updatingParticipantId, removingParticipantId,
  onAttendanceChange, onLevelChange,
  onSaveParticipant, onRemoveParticipant,
  unusedMembers, selectedMember, selectedMemberId,
  onMemberSelect, memberPickerOpen, onMemberPickerOpenChange,
  membersLoading, membersError, onRefreshRoster,
  selectedAttendance, onSelectedAttendanceChange,
  selectedLevel, onSelectedLevelChange,
  selectedCharacterId, participantBusy,
  hasSelectedSession, onAddParticipant,
}: SessionParticipantsPanelProps) {
  return (
    <div>
      <h5 className="mb-2 text-sm font-medium">Participants</h5>
      {participantsError && <p className="mb-2 text-sm text-red-500">{participantsError}</p>}
      {participantsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading participants...
        </div>
      ) : participants.length > 0 ? (
        <div className="space-y-3">
          {participants.map((participant) => {
            const draft = participantDrafts[participant.id] ?? {
              attendance: participant.attendance_status,
              level: participant.character_level_start,
            };
            const isUpdating = updatingParticipantId === participant.id;
            const isRemoving = removingParticipantId === participant.id;

            return (
              <div key={participant.id} className="space-y-2 rounded border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{participant.username}</span>
                    {participant.character_name && (
                      <span className="ml-1 text-muted-foreground">({participant.character_name})</span>
                    )}
                  </div>
                  {!canMutate && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Level {participant.character_level_start}
                        {participant.character_level_end !== participant.character_level_start ? ` \u2192 ${participant.character_level_end}` : ""}
                      </Badge>
                      <Badge
                        variant={participant.attendance_status === 'present' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {formatAttendanceLabel(participant.attendance_status)}
                      </Badge>
                    </div>
                  )}
                </div>
                {canMutate ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        Recorded level {participant.character_level_start}
                        {participant.character_level_end !== participant.character_level_start ? ` \u2192 ${participant.character_level_end}` : ''}
                      </Badge>
                      <Badge
                        variant={participant.attendance_status === 'present' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {formatAttendanceLabel(participant.attendance_status)}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium" htmlFor={`participant-attendance-${participant.id}`}>
                            Attendance
                          </Label>
                          <Select
                            value={draft.attendance}
                            onValueChange={(value) =>
                              onAttendanceChange(participant.id, value as SessionParticipant['attendance_status'])
                            }
                          >
                            <SelectTrigger id={`participant-attendance-${participant.id}`} className="w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ATTENDANCE_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {formatAttendanceLabel(option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium" htmlFor={`participant-level-${participant.id}`}>
                            Level
                          </Label>
                          <Input
                            id={`participant-level-${participant.id}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={20}
                            value={draft.level}
                            className="w-24"
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              onLevelChange(participant.id, Number.isNaN(parsed) ? draft.level : parsed);
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm" variant="outline"
                          onClick={() => onSaveParticipant(participant.id)}
                          disabled={isUpdating || isRemoving}
                        >
                          {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Save
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => onRemoveParticipant(participant.id)}
                          disabled={isRemoving || isUpdating}
                        >
                          {isRemoving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Remove
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No participants recorded for this session yet.</p>
      )}
      {canMutate ? (
        <div className="mt-4 space-y-4 rounded-md border bg-muted/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h6 className="text-sm font-medium">Add participant</h6>
              <p className="text-xs text-muted-foreground">
                Assign a campaign member and capture their attendance for this session.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={onRefreshRoster} disabled={membersLoading}>
              {membersLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh roster
            </Button>
          </div>
          {membersError ? <p className="text-xs text-red-500">{membersError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-xs font-medium">Campaign member</Label>
              <Popover open={memberPickerOpen} onOpenChange={onMemberPickerOpenChange}>
                <PopoverTrigger asChild>
                  <Button
                    type="button" variant="outline" role="combobox"
                    className="w-full justify-between"
                    disabled={membersLoading || unusedMembers.length === 0}
                  >
                    {selectedMember && unusedMembers.some((member) => member.id === selectedMember.id)
                      ? `${selectedMember.username}${selectedMember.character_name ? ` \u2022 ${selectedMember.character_name}` : ''}`
                      : 'Select campaign member'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(320px,90vw)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search campaign members..." />
                    <CommandEmpty>No matching campaign members.</CommandEmpty>
                    <CommandList>
                      {unusedMembers.map((member) => (
                        <CommandItem
                          key={member.id}
                          value={`${member.username} ${member.character_name ?? ''}`.toLowerCase()}
                          onSelect={() => {
                            onMemberSelect(member.id);
                            onMemberPickerOpenChange(false);
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', selectedMemberId === member.id ? 'opacity-100' : 'opacity-0')} />
                          <div className="flex flex-col">
                            <span>{member.username}</span>
                            {member.character_name ? (
                              <span className="text-xs text-muted-foreground">
                                {member.character_name}
                                {member.character_level ? ` \u2022 Level ${member.character_level}` : ''}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">No character assigned</span>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {!membersLoading && unusedMembers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Every campaign member is already attached to this session.
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Attendance</Label>
              <Select
                value={selectedAttendance}
                onValueChange={(value) => onSelectedAttendanceChange(value as SessionParticipant['attendance_status'])}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>{formatAttendanceLabel(option)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium" htmlFor="new-participant-level">Starting level</Label>
              <Input
                id="new-participant-level"
                type="number" inputMode="numeric" min={1} max={20}
                value={selectedLevel}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  onSelectedLevelChange(Number.isNaN(parsed) ? selectedLevel : parsed);
                }}
              />
            </div>
          </div>
          {selectedMember && !selectedMember.character_id ? (
            <p className="text-xs text-red-500">
              Assign a character to {selectedMember.username} before adding them to the session.
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm" onClick={onAddParticipant}
              disabled={participantBusy || !hasSelectedSession || unusedMembers.length === 0 || !selectedMember || !selectedCharacterId}
            >
              {participantBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Add Participant
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
