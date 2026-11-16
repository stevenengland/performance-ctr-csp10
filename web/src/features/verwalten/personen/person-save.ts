import type { Person } from '../../../core/api-client';
import {
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
  /** The person as the server last acknowledged it. */
  readonly person: Readonly<Person>;
  /**
  Saves the draft. Throws the failure when nothing committed (the photo could
  not be encoded, the first request failed, or only the photo was pending and
  failed), so the dialog reports it.
  */
  save: (draft: PersonDraft) => Promise<PersonSaveOutcome>;
}

/**
The saves of one dialog session for a person (§7i), as explicit steps that
remember what committed:

1. **Prepare:** a new photo is encoded first, so a photo the browser cannot
   encode saves nothing.
2. **Name:** `PATCH` only if the name changed; the answer is kept at once.
3. **Photo:** `PUT` of a new photo or `DELETE` of a pending removal; kept at once.
4. **Refresh:** the persons list already shows every acknowledged step; it is then
   reloaded on its own, and a failed reload shows the list's own error without
   undoing the save.

Saving again sends only what has not committed yet: never an unchanged `PATCH`.
*/
export function personSave(person: Readonly<Person>): PersonSave {
  let committed = person;
  let nameCommitted = false;

  async function saveName(name: string): Promise<boolean> {
    if (name.trim() === committed.name) return false;
    committed = await updatePerson(committed.id, name);
    nameCommitted = true;
    return true;
  }

  async function prepare(photo: PhotoChange): Promise<PreparedPhoto> {
    return photo.kind === 'new'
      ? { kind: 'new', image: await photo.encode() }
      : photo;
  }

  async function savePhoto(photo: PreparedPhoto): Promise<boolean> {
    if (photo.kind === 'keep') return false;
    if (photo.kind === 'new') {
      committed = await putPersonPhoto(committed.id, photo.image);
    } else {
      await deletePersonPhoto(committed.id);
      committed = { ...committed, photoUrl: null };
    }
    return true;
  }

  function refresh(): void {
    loadPersons().catch(showProblem);
  }

  async function save(draft: PersonDraft): Promise<PersonSaveOutcome> {
    const photo = await prepare(draft.photo);
    const renamed = await saveName(draft.name);
    let outcome: PersonSaveOutcome = 'saved';
    let photoChanged = false;
    try {
      photoChanged = await savePhoto(photo);
    } catch (failure) {
      if (!nameCommitted) throw failure;
      outcome = 'photoNotSaved';
    }
    if (renamed || photoChanged) refresh();
    return outcome;
  }

  return {
    get person() {
      return committed;
    },
    save,
  };
}
