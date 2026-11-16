import type { Person } from '../../../core/api-client';
import {
  createPerson,
  deletePersonPhoto,
  loadPersons,
  putPersonPhoto,
  updatePerson,
} from '../../../core/catalog';
import { showProblem } from '../../../core/snackbar';

/**
What `Speichern` does to the person's photo. A new photo is framed in the
dialog; `encode` makes the stored JPEG (base64) from it, rejecting with
`PhotoUnreadable` when the browser cannot.
*/
export type PhotoChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'new'; encode: () => Promise<string> };

/** A photo change ready to send: a new photo already encoded. */
type PreparedPhoto =
  { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; image: string };

/** What the dialog holds when `Speichern` is pressed. */
export interface PersonDraft {
  name: string;
  photo: PhotoChange;
}

/**
`photoNotSaved`: the name committed, in this save or an earlier one of the same
dialog, and the photo did not; the photo is still pending.
*/
export type PersonSaveOutcome = 'saved' | 'photoNotSaved';

export interface PersonSave {
  /**
  The person as the server last acknowledged it; none while a new person has
  not been created yet.
  */
  readonly person: Readonly<Person> | undefined;
  /**
  Saves the draft. Throws the failure when nothing committed (the photo could
  not be encoded, the first request failed, or only the photo was pending and
  failed), so the dialog reports it.
  */
  save: (draft: PersonDraft) => Promise<PersonSaveOutcome>;
}

/**
The saves of one dialog session for a person, or for a new one when `person`
is undefined (§7i), as explicit steps that remember what committed:

1. **Prepare:** a new photo is encoded first, so a photo the browser cannot
   encode saves nothing.
2. **Name:** `POST` while the person does not exist yet, otherwise `PATCH` only
   if the name changed; the answer is kept at once.
3. **Photo:** `PUT` of a new photo or `DELETE` of a pending removal; kept at once.
4. **Refresh:** the persons list already shows every acknowledged step; it is then
   reloaded on its own, and a failed reload shows the list's own error without
   undoing the save.

Saving again sends only what has not committed yet: never a second `POST`,
never an unchanged `PATCH`.
*/
export function personSave(person: Readonly<Person> | undefined): PersonSave {
  let committed = person;
  let nameCommitted = false;

  /** Creates the person, or renames them if the name changed; resolves to the person. */
  async function saveName(name: string): Promise<Readonly<Person>> {
    if (!committed) {
      committed = await createPerson(name);
    } else if (name.trim() !== committed.name) {
      committed = await updatePerson(committed.id, name);
    } else {
      return committed;
    }
    nameCommitted = true;
    return committed;
  }

  async function prepare(photo: PhotoChange): Promise<PreparedPhoto> {
    return photo.kind === 'new'
      ? { kind: 'new', image: await photo.encode() }
      : photo;
  }

  async function savePhoto(
    target: Readonly<Person>,
    photo: PreparedPhoto,
  ): Promise<void> {
    if (photo.kind === 'keep') return;
    if (photo.kind === 'new') {
      committed = await putPersonPhoto(target.id, photo.image);
    } else {
      await deletePersonPhoto(target.id);
      committed = { ...target, photoUrl: null };
    }
  }

  function refresh(): void {
    loadPersons().catch(showProblem);
  }

  async function save(draft: PersonDraft): Promise<PersonSaveOutcome> {
    const photo = await prepare(draft.photo);
    const before = committed;
    const target = await saveName(draft.name);
    let outcome: PersonSaveOutcome = 'saved';
    try {
      await savePhoto(target, photo);
    } catch (failure) {
      if (!nameCommitted) throw failure;
      outcome = 'photoNotSaved';
    }
    // Every acknowledged step replaced `committed`.
    if (committed !== before) refresh();
    return outcome;
  }

  return {
    get person() {
      return committed;
    },
    save,
  };
}
