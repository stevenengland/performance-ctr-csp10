import { readonly, shallowRef } from 'vue';
import * as api from './api-client';
import type { Drink, Factor, Person } from './api-client';

/**
Persons, drinks and factors, shared by the add flow and Verwalten, so stepping
through the flow shows them at once; every screen refreshes them when it opens.
*/
const persons = shallowRef<Person[]>();
const drinks = shallowRef<Drink[]>();
const factors = shallowRef<Factor[]>();

export async function loadPersons(): Promise<void> {
  persons.value = await api.listPersons();
}

export async function loadDrinks(): Promise<void> {
  drinks.value = await api.listDrinks();
}

/**
Creates a person and resolves to the server's answer as soon as it is
acknowledged, which then joins the list in alphabetical order; reloading the
list is up to the caller (`loadPersons`), so a failed reload never loses the
created person.
*/
export async function createPerson(name: string): Promise<Person> {
  const person = await api.createPerson(name);
  persons.value = persons.value
    ?.concat(person)
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id - b.id);
  return person;
}

export async function createDrink(
  name: string,
  points: number | null,
): Promise<void> {
  await api.createDrink(name, points);
  await loadDrinks();
}

/**
Renames a person and resolves to the server's answer as soon as it is
acknowledged, which then replaces the person in the list; reloading the list is
up to the caller (`loadPersons`), so a failed reload never fails the rename.
*/
export async function updatePerson(id: number, name: string): Promise<Person> {
  const person = await api.updatePerson(id, name);
  replacePerson(person);
  return person;
}

/** Sets a person's photo and resolves to the server's answer, which then replaces the person in the list. Does not reload. */
export async function putPersonPhoto(
  id: number,
  image: string,
): Promise<Person> {
  const person = await api.putPersonPhoto(id, image);
  replacePerson(person);
  return person;
}

/** Removes a person's photo; once acknowledged the list shows their initials. Does not reload. */
export async function deletePersonPhoto(id: number): Promise<void> {
  await api.deletePersonPhoto(id);
  const person = persons.value?.find((candidate) => candidate.id === id);
  if (person) replacePerson({ ...person, photoUrl: null });
}

function replacePerson(person: Person): void {
  persons.value = persons.value?.map((candidate) =>
    candidate.id === person.id ? person : candidate,
  );
}

export async function deletePerson(id: number): Promise<void> {
  await api.deletePerson(id);
  await loadPersons();
}

export async function updateDrink(
  id: number,
  name: string,
  points: number | null,
): Promise<void> {
  await api.updateDrink(id, name, points);
  await loadDrinks();
}

export async function deleteDrink(id: number): Promise<void> {
  await api.deleteDrink(id);
  await loadDrinks();
}

export async function loadFactors(): Promise<void> {
  factors.value = await api.listFactors();
}

export async function createFactor(
  name: string,
  multiplier: number | null,
): Promise<void> {
  await api.createFactor(name, multiplier);
  await loadFactors();
}

export async function updateFactor(
  id: number,
  name: string,
  multiplier: number | null,
): Promise<void> {
  await api.updateFactor(id, name, multiplier);
  await loadFactors();
}

export async function deleteFactor(id: number): Promise<void> {
  await api.deleteFactor(id);
  await loadFactors();
}

export function usePersons() {
  return readonly(persons);
}

export function useDrinks() {
  return readonly(drinks);
}

export function useFactors() {
  return readonly(factors);
}
