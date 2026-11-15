import { readonly, shallowRef } from 'vue';
import * as api from './api-client';
import type { Drink, Person } from './api-client';

/**
Persons and drinks, shared by the add flow and Verwalten, so stepping through the
flow shows them at once; every screen refreshes them when it opens.
*/
const persons = shallowRef<Person[]>();
const drinks = shallowRef<Drink[]>();

export async function loadPersons(): Promise<void> {
  persons.value = await api.listPersons();
}

export async function loadDrinks(): Promise<void> {
  drinks.value = await api.listDrinks();
}

export async function createPerson(name: string): Promise<void> {
  await api.createPerson(name);
  await loadPersons();
}

export async function createDrink(
  name: string,
  points: number | null,
): Promise<void> {
  await api.createDrink(name, points);
  await loadDrinks();
}

export function usePersons() {
  return readonly(persons);
}

export function useDrinks() {
  return readonly(drinks);
}
