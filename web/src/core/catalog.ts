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

/** Creates a person and answers it, so a photo can follow (§7i). */
export async function createPerson(name: string): Promise<Person> {
  const person = await api.createPerson(name);
  await loadPersons();
  return person;
}

/** Sets (`image`, base64 JPEG) or removes (`null`) a person's photo. */
export async function savePersonPhoto(
  id: number,
  image: string | null,
): Promise<void> {
  if (image === null) await api.deletePersonPhoto(id);
  else await api.putPersonPhoto(id, image);
  await loadPersons();
}

export async function createDrink(
  name: string,
  points: number | null,
): Promise<void> {
  await api.createDrink(name, points);
  await loadDrinks();
}

export async function updatePerson(id: number, name: string): Promise<void> {
  await api.updatePerson(id, name);
  await loadPersons();
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
