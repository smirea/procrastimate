import type { Label, Priority, Project, Recurrence, Reminder } from '../task.ts';
import { generateCases } from './ramble-generate.ts';

/**
 * The Ramble transcript corpus. Every case runs with the pinned clock, Wednesday, October 14 2026 at
 * 10:00, against the seed projects and labels below. See "Testing" in docs/ramble-design.md.
 *
 * Locked cases assert their exact output and are recorded as vectors for the Swift port. Ids in
 * `SCORED` are not asserted one by one; the scorer measures them against the targets instead. A scored
 * case moves to the locked set, by leaving `SCORED`, once it passes. Precision categories are always locked.
 */

export type Category =
	| 'plain'
	| 'single'
	| 'separators'
	| 'natural'
	| 'subtasks'
	| 'notes'
	| 'trigger-words'
	| 'numbers'
	| 'homophones'
	| 'unknown-names'
	| 'corrections'
	| 'dates';

/** Categories whose cases are hand-written precision checks, locked from the start. */
export const PRECISION_CATEGORIES: readonly Category[] = [
	'plain',
	'trigger-words',
	'numbers',
	'homophones',
	'unknown-names',
];

/** Categories that must produce no metadata at all. */
export const NO_METADATA_CATEGORIES: readonly Category[] = ['plain', 'trigger-words'];

export type ExpectedTask = {
	title: string;
	notes?: string;
	/** `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`. */
	due?: string;
	recurrence?: Recurrence;
	priority?: Priority;
	reminders?: Reminder[];
	/** A seed project's name. */
	project?: string;
	/** Seed label names. */
	labels?: string[];
	subtasks?: ExpectedTask[];
};

export type RambleCase = {
	id: string;
	category: Category;
	transcript: string;
	expected: ExpectedTask[];
	ended?: boolean;
};

export const PROJECTS: Project[] = [
	{ id: 'p-home', name: 'Home', createdAt: 0 },
	{ id: 'p-work', name: 'Work', createdAt: 0 },
	{ id: 'p-side', name: 'Side Project', createdAt: 0 },
	{ id: 'p-indonesia', name: 'Indonesia', createdAt: 0 },
	{ id: 'p-finance', name: 'Finance', createdAt: 0 },
];

export const LABELS: Label[] = [
	{ id: 'l-calls', name: 'calls', createdAt: 0 },
	{ id: 'l-errands', name: 'errands', createdAt: 0 },
	{ id: 'l-waiting', name: 'waiting', createdAt: 0 },
	{ id: 'l-deep', name: 'deep work', createdAt: 0 },
];

const t = (title: string, fields: Omit<ExpectedTask, 'title'> = {}): ExpectedTask => ({ title, ...fields });
const plain = (...titles: string[]) => titles.map(title => t(title));
const weekly: Recurrence = { interval: 1, unit: 'week' };
const before = (minutes: number): Reminder => ({ kind: 'before', minutes });
const at = (date: string, time: string): Reminder => ({ kind: 'at', date, time }) as Reminder;

type Row = [transcript: string, expected: ExpectedTask[], extra?: { ended?: boolean }];

const HAND_WRITTEN: Record<Category, Row[]> = {
	plain: [
		['Buy milk. Call the plumber about the leak.', plain('Buy milk', 'Call the plumber about the leak')],
		['Pick up the dry cleaning', plain('Pick up the dry cleaning')],
		['Renew my passport', plain('Renew my passport')],
		['Clean out the fridge. Take the recycling out.', plain('Clean out the fridge', 'Take the recycling out')],
		['Look into new running shoes', plain('Look into new running shoes')],
		['Return the library books.', plain('Return the library books')],
		['Fix the squeaky door in the hallway', plain('Fix the squeaky door in the hallway')],
		['Buy a birthday card for Anna', plain('Buy a birthday card for Anna')],
		['Schedule a haircut', plain('Schedule a haircut')],
		['Call grandma', plain('Call grandma')],
		[
			'Order more coffee beans. Descale the espresso machine.',
			plain('Order more coffee beans', 'Descale the espresso machine'),
		],
		['Research flights to Lisbon', plain('Research flights to Lisbon')],
		['Back up the laptop', plain('Back up the laptop')],
		['Cancel the gym membership', plain('Cancel the gym membership')],
		['Write thank you notes', plain('Write thank you notes')],
		['Update the resume. Ask Jake for a reference.', plain('Update the resume', 'Ask Jake for a reference')],
		['Sort out the garage shelves', plain('Sort out the garage shelves')],
		['Read the article Tom sent', plain('Read the article Tom sent')],
		['Check the tire pressure', plain('Check the tire pressure')],
		['Buy batteries, light bulbs, and tape', plain('Buy batteries, light bulbs, and tape')],
		['Find a dentist near the new apartment', plain('Find a dentist near the new apartment')],
		['Replace the smoke detector battery', plain('Replace the smoke detector battery')],
		['Get the car washed', plain('Get the car washed')],
		["Plan Sam's surprise party", plain("Plan Sam's surprise party")],
		['Water the tomatoes', plain('Water the tomatoes')],
		['Pay the parking ticket', plain('Pay the parking ticket')],
		['Move the couch upstairs', plain('Move the couch upstairs')],
		['Text Maria about the keys', plain('Text Maria about the keys')],
		['Hang the picture frames in the hall', plain('Hang the picture frames in the hall')],
		[
			'Wrap the presents. Bake cookies for the neighbors.',
			plain('Wrap the presents', 'Bake cookies for the neighbors'),
		],
		['Buy stamps', plain('Buy stamps')],
		['Print the boarding passes', plain('Print the boarding passes')],
		['Defrost the freezer', plain('Defrost the freezer')],
		['Donate old clothes', plain('Donate old clothes')],
		['Learn some Spanish phrases', plain('Learn some Spanish phrases')],
		['Call the insurance company about the claim', plain('Call the insurance company about the claim')],
		["Book a table for Saturday's dinner", plain("Book a table for Saturday's dinner")],
		['Mail the package to Dad', plain('Mail the package to Dad')],
		['Make a dentist appointment', plain('Make a dentist appointment')],
		[
			'Vacuum the stairs. Mop the kitchen floor. Dust the shelves.',
			plain('Vacuum the stairs', 'Mop the kitchen floor', 'Dust the shelves'),
		],
	],
	single: [
		['Pay rent tomorrow', [t('Pay rent', { due: '2026-10-15' })]],
		['Email Dana priority 2', [t('Email Dana', { priority: 2 })]],
		['Water plants every Sunday', [t('Water plants', { due: '2026-10-18', recurrence: weekly })]],
		['Book flights, add it to the Indonesia project', [t('Book flights', { project: 'Indonesia' })]],
		['Call the bank label calls', [t('Call the bank', { labels: ['calls'] })]],
		['Renew insurance on Friday', [t('Renew insurance', { due: '2026-10-16' })]],
		['Submit the expense report in project Work', [t('Submit the expense report', { project: 'Work' })]],
		['Buy groceries with the errands label', [t('Buy groceries', { labels: ['errands'] })]],
		['File taxes priority one', [t('File taxes', { priority: 1 })]],
		['Call mom tonight', [t('Call mom', { due: '2026-10-14 20:00' })]],
		['Send the invoice by end of day', [t('Send the invoice', { due: '2026-10-14 17:00' })]],
		['Take out the trash every Tuesday', [t('Take out the trash', { due: '2026-10-20', recurrence: weekly })]],
		['Dentist appointment tomorrow at 3pm', [t('Dentist appointment', { due: '2026-10-15 15:00' })]],
		['Clean the gutters for the Home project', [t('Clean the gutters', { project: 'Home' })]],
		['Follow up with the landlord, label waiting', [t('Follow up with the landlord', { labels: ['waiting'] })]],
		['Pay the credit card bill in project Finance', [t('Pay the credit card bill', { project: 'Finance' })]],
		['Pay the invoice in project Finances', [t('Pay the invoice', { project: 'Finance' })]],
		['Draft the proposal p3', [t('Draft the proposal', { priority: 3 })]],
		['Call the vet at 4pm', [t('Call the vet', { due: '2026-10-14 16:00' })]],
		['Pick up Anna next Monday', [t('Pick up Anna', { due: '2026-10-19' })]],
		['Stretch every day', [t('Stretch', { due: '2026-10-14', recurrence: { interval: 1, unit: 'day' } })]],
		['Prepare slides in two weeks', [t('Prepare slides', { due: '2026-10-28' })]],
		['Write the blog post labels deep work', [t('Write the blog post', { labels: ['deep work'] })]],
		['Move savings to the Finance project', [t('Move savings', { project: 'Finance' })]],
		['Call the dentist remind me at 4pm', [t('Call the dentist', { reminders: [at('2026-10-14', '16:00')] })]],
		['Order the new desk priority three', [t('Order the new desk', { priority: 3 })]],
		['Fix the roof, put it in the Home project', [t('Fix the roof', { project: 'Home' })]],
		['Tag it errands, pick up the parcel', [t('Pick up the parcel', { labels: ['errands'] })]],
	],
	separators: [
		[
			'Buy paint next task call mom tonight new task renew passport',
			[t('Buy paint'), t('Call mom', { due: '2026-10-14 20:00' }), t('Renew passport')],
		],
		['Call the bank next task email Dana next task book flights', plain('Call the bank', 'Email Dana', 'Book flights')],
		['Wash the car, next task, vacuum the house', plain('Wash the car', 'Vacuum the house')],
		[
			'Buy eggs another task buy flour, and another thing, preheat the oven',
			plain('Buy eggs', 'Buy flour', 'Preheat the oven'),
		],
		['Next task pay rent tomorrow next task call grandma', [t('Pay rent', { due: '2026-10-15' }), t('Call grandma')]],
		['Pick up the kids next one get gas next one buy milk', plain('Pick up the kids', 'Get gas', 'Buy milk')],
		[
			'Fix the fence priority 2 new task paint the shed in project Home',
			[t('Fix the fence', { priority: 2 }), t('Paint the shed', { project: 'Home' })],
		],
		[
			'Email the team next task review the budget label deep work',
			[t('Email the team'), t('Review the budget', { labels: ['deep work'] })],
		],
		['Book the hotel. Next task. Rent a car.', plain('Book the hotel', 'Rent a car')],
		[
			'Call the plumber new task call the electrician new task call the roofer',
			plain('Call the plumber', 'Call the electrician', 'Call the roofer'),
		],
		[
			'Book a massage next task pay the water bill on Friday',
			[t('Book a massage'), t('Pay the water bill', { due: '2026-10-16' })],
		],
		[
			'Water the plants new task feed the cat new task walk the dog tonight',
			[t('Water the plants'), t('Feed the cat'), t('Walk the dog', { due: '2026-10-14 20:00' })],
		],
		['Clean the bathroom next task, laundry', plain('Clean the bathroom', 'Laundry')],
		[
			'Buy wine new task buy cheese new task buy bread new task buy grapes',
			plain('Buy wine', 'Buy cheese', 'Buy bread', 'Buy grapes'),
		],
		[
			'Renew the domain next task, update the DNS records, priority one',
			[t('Renew the domain'), t('Update the DNS records', { priority: 1 })],
		],
	],
	natural: [
		[
			"I need to buy milk, oh and call mom tomorrow, and the report's due Friday",
			[t('Buy milk'), t('Call mom', { due: '2026-10-15' }), t('The report', { due: '2026-10-16' })],
		],
		[
			'So I have to pick up the dry cleaning and then I need to call the bank about the card',
			plain('Pick up the dry cleaning', 'Call the bank about the card'),
		],
		[
			'Tomorrow I need to call the dentist and buy dog food',
			[t('Call the dentist', { due: '2026-10-15' }), t('Buy dog food')],
		],
		[
			'I should email Dana about the contract, also water the plants',
			plain('Email Dana about the contract', 'Water the plants'),
		],
		[
			"Don't forget to pay the electric bill on Friday and remember to book the flights",
			[t('Pay the electric bill', { due: '2026-10-16' }), t('Book the flights')],
		],
		['Buy eggs, milk and bread, then clean the kitchen', plain('Buy eggs, milk and bread', 'Clean the kitchen')],
		['Call mom, email the landlord, and book a haircut', plain('Call mom', 'Email the landlord', 'Book a haircut')],
		['I gotta fix the bike tire and I want to order a new helmet', plain('Fix the bike tire', 'Order a new helmet')],
		[
			'Okay so first, renew the car registration, then schedule the oil change',
			plain('Renew the car registration', 'Schedule the oil change'),
		],
		[
			"I need to finish the slides for Monday's meeting and send them to Priya",
			plain("Finish the slides for Monday's meeting", 'Send them to Priya'),
		],
		[
			'Pick up the package at the post office and then grab coffee with Sam',
			plain('Pick up the package at the post office', 'Grab coffee with Sam'),
		],
		[
			'I have to call the insurance company, oh and also cancel the old policy',
			plain('Call the insurance company', 'Cancel the old policy'),
		],
		['Write the newsletter and post it on Friday', [t('Write the newsletter'), t('Post it', { due: '2026-10-16' })]],
		[
			'Clean the bathroom then vacuum the living room then do the laundry',
			plain('Clean the bathroom', 'Vacuum the living room', 'Do the laundry'),
		],
		[
			"I need to get a gift for Mia's birthday, she likes books",
			plain("Get a gift for Mia's birthday, she likes books"),
		],
		[
			'Call the plumber tomorrow morning and ask about the water heater',
			[t('Call the plumber and ask about the water heater', { due: '2026-10-15' })],
		],
		['Remember to buy stamps and mail the letters', plain('Buy stamps', 'Mail the letters')],
		["Pay rent, it's due on the first", [t('Pay rent', { due: '2026-11-01' })]],
		[
			'I need to call Alex about the lease and I should also check the smoke detectors',
			plain('Call Alex about the lease', 'Check the smoke detectors'),
		],
		['Get groceries and cook dinner tonight', [t('Get groceries'), t('Cook dinner', { due: '2026-10-14 20:00' })]],
		[
			'Oh I need to text Ben back, and also look at the car insurance quotes',
			plain('Text Ben back', 'Look at the car insurance quotes'),
		],
		[
			'Schedule the vet appointment for Luna and buy more cat litter',
			plain('Schedule the vet appointment for Luna', 'Buy more cat litter'),
		],
		[
			'I have a call with Sarah at 3pm and I need to prep the agenda',
			[t('I have a call with Sarah', { due: '2026-10-14 15:00' }), t('Prep the agenda')],
		],
		['Buy a new charger because mine broke', plain('Buy a new charger because mine broke')],
		['Email the client the revised quote and copy Mark', plain('Email the client the revised quote and copy Mark')],
		[
			'I need to book a dentist appointment, renew my license, and buy a gift for Mom',
			plain('Book a dentist appointment', 'Renew my license', 'Buy a gift for Mom'),
		],
		[
			'Take the car in for service on Monday, then pick it up on Wednesday',
			[t('Take the car in for service', { due: '2026-10-19' }), t('Pick it up', { due: '2026-10-14' })],
		],
		[
			'Pick up a prescription and some groceries on the way home',
			plain('Pick up a prescription and some groceries on the way home'),
		],
		['I want to start running again and sign up for the 10k', plain('Start running again', 'Sign up for the 10k')],
		[
			'Ask Priya for the slides and then send the deck to the board by Thursday',
			[t('Ask Priya for the slides'), t('Send the deck to the board', { due: '2026-10-15' })],
		],
		["I should probably clean the oven, it's disgusting", plain("Clean the oven, it's disgusting")],
		['Buy flowers for Jen and write her a card', plain('Buy flowers for Jen', 'Write her a card')],
		[
			'Need to renew the parking permit before it expires next week',
			[t('Renew the parking permit before it expires', { due: '2026-10-19' })],
		],
		["Organize the closet and donate what doesn't fit", plain('Organize the closet', "Donate what doesn't fit")],
		[
			'Hey so tomorrow call the school about the field trip form',
			[t('Call the school about the field trip form', { due: '2026-10-15' })],
		],
		[
			'I need to pay Sam back for dinner and also Venmo Lisa for the tickets',
			plain('Pay Sam back for dinner', 'Venmo Lisa for the tickets'),
		],
		[
			'Make dinner reservations for Friday and confirm the babysitter',
			[t('Make dinner reservations', { due: '2026-10-16' }), t('Confirm the babysitter')],
		],
		['Fix the leaky faucet, I keep forgetting', plain('Fix the leaky faucet, I keep forgetting')],
		['Clean the gutters and then I have to mow the lawn', plain('Clean the gutters', 'Mow the lawn')],
		[
			'Call Dad about Thanksgiving plans, and look up train times',
			plain('Call Dad about Thanksgiving plans', 'Look up train times'),
		],
		['I need to buy milk. Also the car needs gas.', plain('Buy milk', 'The car needs gas')],
		// Held out: written after the grammar and first run before any tuning against them.
		[
			'Okay, so today I need to call the bank about the mortgage. Then I have to pick up Lily from school at 3pm. Oh, and I should book the car service for next week.',
			[
				t('Call the bank about the mortgage', { due: '2026-10-14' }),
				t('Pick up Lily from school', { due: '2026-10-14 15:00' }),
				t('Book the car service', { due: '2026-10-19' }),
			],
		],
		[
			'Um, let me think. Buy a birthday present for Jake, his party is on Saturday.',
			[t('Buy a birthday present for Jake', { due: '2026-10-17' })],
		],
		[
			"I need to renew my driver's license before it expires. And I should get new glasses.",
			plain("Renew my driver's license before it expires", 'Get new glasses'),
		],
		[
			'Groceries: eggs, spinach, and oat milk. Also call the vet tomorrow.',
			[t('Groceries: eggs, spinach, and oat milk'), t('Call the vet', { due: '2026-10-15' })],
		],
		[
			'So this week I want to finish the Q3 report, prep for the board meeting on Thursday, and maybe start on the budget.',
			[t('Finish the Q3 report'), t('Prep for the board meeting', { due: '2026-10-15' }), t('Start on the budget')],
		],
		[
			'Remind me to text Chloe tonight about dinner plans.',
			[t('Text Chloe about dinner plans', { due: '2026-10-14 20:00' })],
		],
		[
			'The dishwasher is broken so I need to call a repair guy.',
			plain('The dishwasher is broken so I need to call a repair guy'),
		],
		[
			"Pick up milk on the way home. Pay the phone bill, it's due Friday. And email Karen the photos.",
			[t('Pick up milk on the way home'), t('Pay the phone bill', { due: '2026-10-16' }), t('Email Karen the photos')],
		],
		["I've got a dentist appointment on Tuesday at 10am.", [t('Dentist appointment', { due: '2026-10-20 10:00' })]],
		[
			'Need to order more printer ink and paper for the office.',
			plain('Order more printer ink and paper for the office'),
		],
		[
			'Clean the kitchen, do the laundry, and then take out the trash.',
			plain('Clean the kitchen', 'Do the laundry', 'Take out the trash'),
		],
		[
			'Call Mom back. She called earlier about Sunday lunch.',
			plain('Call Mom back', 'She called earlier about Sunday lunch'),
		],
		[
			"Book a flight to Denver for the conference, it's on the 22nd.",
			[t('Book a flight to Denver for the conference', { due: '2026-10-22' })],
		],
		['Get a haircut sometime this week.', plain('Get a haircut sometime this week')],
		['I need to call the electrician and the plumber.', plain('Call the electrician and the plumber')],
		['Make sure to back up the photos before the trip.', plain('Back up the photos before the trip')],
		['Water the plants and feed the fish every morning.', plain('Water the plants', 'Feed the fish every morning')],
		['Send Mark the slides by noon tomorrow.', [t('Send Mark the slides', { due: '2026-10-15 12:00' })]],
		['Look up flights to Rome. Priority two.', [t('Look up flights to Rome', { priority: 2 })]],
		[
			'Call the pharmacy about the refill, label calls.',
			[t('Call the pharmacy about the refill', { labels: ['calls'] })],
		],
		['Text Amir happy birthday on Friday.', [t('Text Amir happy birthday', { due: '2026-10-16' })]],
		[
			"Let's see, I need to sign the lease, transfer the deposit, and set up internet at the new place.",
			plain('Sign the lease', 'Transfer the deposit', 'Set up internet at the new place'),
		],
		['Buy a new phone case and a screen protector.', plain('Buy a new phone case and a screen protector')],
		[
			'Finish reading the book for book club on Thursday.',
			[t('Finish reading the book for book club', { due: '2026-10-15' })],
		],
		['I really need to go to the gym tomorrow morning.', [t('Go to the gym', { due: '2026-10-15' })]],
		[
			'Schedule a call with the accountant next week, and gather all the tax documents.',
			[t('Schedule a call with the accountant', { due: '2026-10-19' }), t('Gather all the tax documents')],
		],
		[
			'Oh, the car registration expires at the end of the month, so renew that.',
			plain('The car registration expires at the end of the month, so renew that'),
		],
		[
			'Pick up the kids at 3:30, then take Max to soccer practice at 5pm.',
			[t('Pick up the kids at 3:30'), t('Take Max to soccer practice', { due: '2026-10-14 17:00' })],
		],
		[
			'Return the Amazon package, the label is in my email.',
			plain('Return the Amazon package, the label is in my email'),
		],
		[
			"Next week I have to submit the grant application. That's the big one.",
			[t('Submit the grant application', { due: '2026-10-19' }), t("That's the big one")],
		],
	],
	subtasks: [
		[
			'Plan the party with subtasks invitations, cake, and music',
			[t('Plan the party', { subtasks: plain('Invitations', 'Cake', 'Music') })],
		],
		['Clean garage. Subtask sort tools.', [t('Clean garage', { subtasks: plain('Sort tools') })]],
		[
			'Prepare the trip with subtasks book flights, reserve the hotel and buy travel insurance',
			[t('Prepare the trip', { subtasks: plain('Book flights', 'Reserve the hotel', 'Buy travel insurance') })],
		],
		[
			'Move apartments subtask pack the kitchen subtask hire movers',
			[t('Move apartments', { subtasks: plain('Pack the kitchen', 'Hire movers') })],
		],
		[
			'Launch the website. Subtask write the copy. Subtask test the contact form.',
			[t('Launch the website', { subtasks: plain('Write the copy', 'Test the contact form') })],
		],
		[
			'Renovate the bathroom with sub tasks pick tiles and get quotes',
			[t('Renovate the bathroom', { subtasks: plain('Pick tiles', 'Get quotes') })],
		],
		[
			'Do taxes with sub-tasks gather receipts, download statements, and file the return',
			[t('Do taxes', { subtasks: plain('Gather receipts', 'Download statements', 'File the return') })],
		],
		[
			'Write the report tomorrow with subtasks outline, draft, and edit',
			[t('Write the report', { due: '2026-10-15', subtasks: plain('Outline', 'Draft', 'Edit') })],
		],
		[
			'Clean the house. Add a subtask vacuum. Add a subtask dust.',
			[t('Clean the house', { subtasks: plain('Vacuum', 'Dust') })],
		],
		[
			'Organize the wedding shower in project Home with subtasks send invites and order cake',
			[t('Organize the wedding shower', { project: 'Home', subtasks: plain('Send invites', 'Order cake') })],
		],
		[
			'Fix the car. Subtask buy brake pads priority 2.',
			[t('Fix the car', { subtasks: [t('Buy brake pads', { priority: 2 })] })],
		],
		[
			'Plan the offsite with subtasks pick a venue and book catering. Next task email Dana.',
			[t('Plan the offsite', { subtasks: plain('Pick a venue', 'Book catering') }), t('Email Dana')],
		],
		[
			'Prep for the interview subtask research the company subtask practice answers tonight',
			[
				t('Prep for the interview', {
					subtasks: [t('Research the company'), t('Practice answers', { due: '2026-10-14 20:00' })],
				}),
			],
		],
		[
			'Spring cleaning with subtasks windows, carpets, and the garage',
			[t('Spring cleaning', { subtasks: plain('Windows', 'Carpets', 'The garage') })],
		],
		[
			'Paint the bedroom. Subtask buy paint. Subtask move the furniture. Subtask tape the trim.',
			[t('Paint the bedroom', { subtasks: plain('Buy paint', 'Move the furniture', 'Tape the trim') })],
		],
		[
			'Get ready for the trip, subtasks: pack, water plants, and lock up',
			[t('Get ready for the trip', { subtasks: plain('Pack', 'Water plants', 'Lock up') })],
		],
		[
			'Set up the new laptop with subtasks install updates and copy files label deep work',
			[
				t('Set up the new laptop', {
					subtasks: [t('Install updates'), t('Copy files', { labels: ['deep work'] })],
				}),
			],
		],
		['Bake a cake. Add a subtask buy flour.', [t('Bake a cake', { subtasks: plain('Buy flour') })]],
		[
			'Garden cleanup with subtasks rake leaves and trim hedges. Due Saturday.',
			[t('Garden cleanup', { due: '2026-10-17', subtasks: plain('Rake leaves', 'Trim hedges') })],
		],
		[
			'Plan the trip to Bali, add it to the Indonesia project, with subtasks book flights and get visas',
			[t('Plan the trip to Bali', { project: 'Indonesia', subtasks: plain('Book flights', 'Get visas') })],
		],
		['Subtask buy candles', plain('Buy candles')],
		[
			'Host dinner Saturday. Subtask buy wine. Subtask clean the table. Scratch that.',
			[t('Host dinner', { due: '2026-10-17', subtasks: plain('Buy wine') })],
		],
		[
			'Clean the attic with subtasks sort boxes and call the junk removal company tomorrow',
			[
				t('Clean the attic', {
					subtasks: [t('Sort boxes'), t('Call the junk removal company', { due: '2026-10-15' })],
				}),
			],
		],
		['Repaint the fence with a subtask buy brushes', [t('Repaint the fence', { subtasks: plain('Buy brushes') })]],
		[
			'Organize the photos. Subtask scan the old albums. Another task call Grandpa.',
			[t('Organize the photos', { subtasks: plain('Scan the old albums') }), t('Call Grandpa')],
		],
	],
	notes: [
		['Buy paint. Note: the blue one from Home Depot.', [t('Buy paint', { notes: 'the blue one from Home Depot' })]],
		[
			'Call the landlord. Note the heater is broken again.',
			[t('Call the landlord', { notes: 'the heater is broken again' })],
		],
		[
			'Book the restaurant, note: they need a credit card',
			[t('Book the restaurant', { notes: 'they need a credit card' })],
		],
		['Email Jess. The note is she prefers mornings.', [t('Email Jess', { notes: 'she prefers mornings' })]],
		[
			'Pick up the cake tomorrow. Details: chocolate, no nuts.',
			[t('Pick up the cake', { due: '2026-10-15', notes: 'chocolate, no nuts' })],
		],
		['Fix the sink, add a note the part number is 4417', [t('Fix the sink', { notes: 'the part number is 4417' })]],
		['Call Mike with a note that he owes us fifty dollars', [t('Call Mike', { notes: 'he owes us fifty dollars' })]],
		[
			'Renew the passport. Notes: bring two photos and the old passport.',
			[t('Renew the passport', { notes: 'bring two photos and the old passport' })],
		],
		[
			'Buy a gift for Ana. Note: she likes ceramics. Next task call the florist.',
			[t('Buy a gift for Ana', { notes: 'she likes ceramics' }), t('Call the florist')],
		],
		[
			'Schedule the meeting Friday at 2pm. Note: invite the design team.',
			[t('Schedule the meeting', { due: '2026-10-16 14:00', notes: 'invite the design team' })],
		],
		[
			'Order the couch. Note: the store closes on Friday.',
			[t('Order the couch', { notes: 'the store closes on Friday' })],
		],
		[
			'Prep the presentation. Note priority is the budget slide.',
			[t('Prep the presentation', { notes: 'priority is the budget slide' })],
		],
		['Call the bank, note the account ends in 2231', [t('Call the bank', { notes: 'the account ends in 2231' })]],
		[
			'Send the contract to Liz. Details: use the new template, sign page 4.',
			[t('Send the contract to Liz', { notes: 'use the new template, sign page 4' })],
		],
		[
			'Return the jacket. Note the receipt is in the drawer. Tomorrow.',
			[t('Return the jacket', { due: '2026-10-15', notes: 'the receipt is in the drawer' })],
		],
		[
			'Write to the council about the potholes, note: reference the March letter',
			[t('Write to the council about the potholes', { notes: 'reference the March letter' })],
		],
		['Book the vet. Note Luna needs her rabies shot.', [t('Book the vet', { notes: 'Luna needs her rabies shot' })]],
		[
			'Plan the hike. The notes are bring water and sunscreen.',
			[t('Plan the hike', { notes: 'bring water and sunscreen' })],
		],
		[
			'Buy new tires. Note: get a quote from two shops first.',
			[t('Buy new tires', { notes: 'get a quote from two shops first' })],
		],
		['Clean the grill with a note use the wire brush', [t('Clean the grill', { notes: 'use the wire brush' })]],
	],
	'trigger-words': [
		['Finish the project report', plain('Finish the project report')],
		['Label the boxes in the garage', plain('Label the boxes in the garage')],
		['Note to self buy stamps', plain('Note to self buy stamps')],
		['This is important, call the bank', plain('This is important, call the bank')],
		["Review Tuesday's notes", plain("Review Tuesday's notes")],
		['Priority to finish the deck', plain('Priority to finish the deck')],
		['Send the urgent package', plain('Send the urgent package')],
		['Print the project timeline', plain('Print the project timeline')],
		['Buy a label maker', plain('Buy a label maker')],
		['Tag the photos from the trip', plain('Tag the photos from the trip')],
		['Read every chapter of the book', plain('Read every chapter of the book')],
		['Ask about the due process', plain('Ask about the due process')],
		['Remind Sam about the meeting', plain('Remind Sam about the meeting')],
		['Check my priorities for the quarter', plain('Check my priorities for the quarter')],
		['Make it to the gym', plain('Make it to the gym')],
		['Write a note for the babysitter', plain('Write a note for the babysitter')],
		['Project the slides on the wall', plain('Project the slides on the wall')],
		['Buy Monday Night Football tickets', plain('Buy Monday Night Football tickets')],
		['Shop the Black Friday deals', plain('Shop the Black Friday deals')],
		['Watch Sunday Morning on CBS', plain('Watch Sunday Morning on CBS')],
		['Fix the date on the invoice', plain('Fix the date on the invoice')],
		['Plan for the big day', plain('Plan for the big day')],
		['Thank everyone who came', plain('Thank everyone who came')],
		['Ask the project manager for the timeline', plain('Ask the project manager for the timeline')],
		['Buy priority mail stamps', plain('Buy priority mail stamps')],
		['Grab the labels from the printer', plain('Grab the labels from the printer')],
		['Check every window is locked', plain('Check every window is locked')],
		['Discuss the important stuff with Jo', plain('Discuss the important stuff with Jo')],
		['Get the urgent care bill sorted', plain('Get the urgent care bill sorted')],
		['Look at the due diligence docs', plain('Look at the due diligence docs')],
		['Find the notes from the meeting', plain('Find the notes from the meeting')],
		['Make it a habit to stretch', plain('Make it a habit to stretch')],
		['Call Daily Bread bakery', plain('Call Daily Bread bakery')],
		['Watch the Weekly Show episode', plain('Watch the Weekly Show episode')],
		['Read the monthly report', plain('Read the monthly report')],
		['Tell May about the sale', plain('Tell May about the sale')],
		['Organize the sun room', plain('Organize the sun room')],
		['Buy tape. Label the boxes in the garage.', plain('Buy tape', 'Label the boxes in the garage')],
		['Call the bank. Priority to finish the deck.', plain('Call the bank', 'Priority to finish the deck')],
		['Make it a priority to call Grandma', plain('Make it a priority to call Grandma')],
		['Book the March Madness tickets', plain('Book the March Madness tickets')],
		['Buy tickets for the project launch', plain('Buy tickets for the project launch')],
	],
	numbers: [
		['Call 1800 flowers', plain('Call 1800 flowers')],
		['Buy 2 tickets for May 3rd', [t('Buy 2 tickets', { due: '2027-05-03' })]],
		['Read chapter 5', plain('Read chapter 5')],
		['Order 5M screws', plain('Order 5M screws')],
		['Team of 4 dinner at 7pm', [t('Team of 4 dinner', { due: '2026-10-14 19:00' })]],
		['Buy four tickets', plain('Buy four tickets')],
		['Run 5k on Saturday', [t('Run 5k', { due: '2026-10-17' })]],
		['Study for 2 hours', plain('Study for 2 hours')],
		['Study for two hours', plain('Study for two hours')],
		['Pay the 2026 tax bill', plain('Pay the 2026 tax bill')],
		['Call room 1204 reception', plain('Call room 1204 reception')],
		['Book flight 1730 to Denver', plain('Book flight 1730 to Denver')],
		['Meet Jo at 1730', [t('Meet Jo', { due: '2026-10-14 17:30' })]],
		['Buy 3 bags of soil', plain('Buy 3 bags of soil')],
		['Read the 5th chapter', plain('Read the 5th chapter')],
		['Pay rent on the 1st', [t('Pay rent', { due: '2026-11-01' })]],
		['Take 2 pills', plain('Take 2 pills')],
		['Water the 12 plants', plain('Water the 12 plants')],
		['Buy 10 stamps', plain('Buy 10 stamps')],
		['Fix the 2nd floor bathroom', plain('Fix the 2nd floor bathroom')],
		['Order 2 hours of tutoring', plain('Order 2 hours of tutoring')],
		['Call Ben in 10 minutes', [t('Call Ben', { due: '2026-10-14 10:10' })]],
		['Split the bill in 3', plain('Split the bill in 3')],
		['Buy a 5 pack of socks', plain('Buy a 5 pack of socks')],
		['Back up 500 photos', plain('Back up 500 photos')],
	],
	homophones: [
		['Email Dana priority for', [t('Email Dana', { priority: 4 })]],
		['Call the bank priority won', [t('Call the bank', { priority: 1 })]],
		['Call mom pee one', [t('Call mom', { priority: 1 })]],
		['Fix the bug priority too', [t('Fix the bug', { priority: 2 })]],
		['Remind me too', plain('Remind me too')],
		['Get four tickets for the concert', plain('Get four tickets for the concert')],
		['Water the garden priority fore', [t('Water the garden', { priority: 4 })]],
		['Review the budget priority to.', [t('Review the budget', { priority: 2 })]],
		['Call Sam priority to discuss the deal', plain('Call Sam priority to discuss the deal')],
		['Send the slides p two', [t('Send the slides', { priority: 2 })]],
		['Send the slides pee 3', [t('Send the slides', { priority: 3 })]],
		['Book flights priority number one', [t('Book flights', { priority: 1 })]],
		['Pay the bill priority for, next task call mom', [t('Pay the bill', { priority: 4 }), t('Call mom')]],
		['Clean the car priority for the weekend', plain('Clean the car priority for the weekend')],
		['File the report P1', [t('File the report', { priority: 1 })]],
		['Fix the fence, priority three.', [t('Fix the fence', { priority: 3 })]],
		['Make dinner for two', plain('Make dinner for two')],
		['Order lunch for four', plain('Order lunch for four')],
		['Call the doctor at five pm', [t('Call the doctor', { due: '2026-10-14 17:00' })]],
		['Pick up Ava at five p.m. tomorrow', [t('Pick up Ava', { due: '2026-10-15 17:00' })]],
		['Walk the dog at quarter to six pm', [t('Walk the dog', { due: '2026-10-14 17:45' })]],
	],
	'unknown-names': [
		['Plant tulips project Garden', plain('Plant tulips project Garden')],
		['Call the bank label urgent', plain('Call the bank label urgent')],
		['Fix the gate in the Garden project', plain('Fix the gate in the Garden project')],
		['Email Bob with the travel label', plain('Email Bob with the travel label')],
		['Buy shoes tag shopping', plain('Buy shoes tag shopping')],
		['Book flights, add it to the Japan project', plain('Book flights, add it to the Japan project')],
		['Review slides in project Clients', plain('Review slides in project Clients')],
		['Call Ana labels family and friends', plain('Call Ana labels family and friends')],
		['Write the essay for the School project', plain('Write the essay for the School project')],
		['Mow the lawn for the Homestead project', plain('Mow the lawn for the Homestead project')],
		['Buy paint tag it blue', plain('Buy paint tag it blue')],
		['Sort mail with the junk label', plain('Sort mail with the junk label')],
		['File receipts in project Taxes', plain('File receipts in project Taxes')],
		['Hire a designer for the Rebrand project', plain('Hire a designer for the Rebrand project')],
		['Text Lee label work', plain('Text Lee label work')],
	],
	corrections: [
		['Buy eggs scratch that buy bread', plain('Buy bread')],
		["Call mom tomorrow at 5 p.m. That's all.", [t('Call mom', { due: '2026-10-15 17:00' })], { ended: true }],
		['Buy milk. Call the bank. Scratch that.', plain('Buy milk')],
		['Book the hotel. Never mind. Book the Airbnb.', plain('Book the Airbnb')],
		['Email Dana remove that email Sam', plain('Email Sam')],
		["Pick up the kids. That's it.", plain('Pick up the kids'), { ended: true }],
		['Water the plants, delete that, water the lawn', plain('Water the lawn')],
		["Buy flowers that's all for now", plain('Buy flowers'), { ended: true }],
		['Call the plumber. Actually scratch that.', []],
		['Remove that stain from the couch', plain('Remove that stain from the couch')],
		['I need to delete that file', plain('Delete that file')],
		[
			'Fix the fence next task paint the shed scratch that next task mow the lawn',
			plain('Fix the fence', 'Mow the lawn'),
		],
		['Order pizza tonight. Scratch that. Order sushi tonight.', [t('Order sushi', { due: '2026-10-14 20:00' })]],
		['Buy stamps. That is all.', plain('Buy stamps'), { ended: true }],
		['Call Sam, never mind, call Alex priority one', [t('Call Alex', { priority: 1 })]],
	],
	dates: [
		['Gym every other week on Monday', [t('Gym', { due: '2026-10-19', recurrence: { interval: 2, unit: 'week' } })]],
		['Call mom in two weeks', [t('Call mom', { due: '2026-10-28' })]],
		['Pick up Ava at half past five pm', [t('Pick up Ava', { due: '2026-10-14 17:30' })]],
		['Lunch with Sara next Friday at noon', [t('Lunch with Sara', { due: '2026-10-23 12:00' })]],
		[
			'Call the dentist tomorrow at 9am remind me 30 minutes before',
			[t('Call the dentist', { due: '2026-10-15 09:00', reminders: [before(30)] })],
		],
		['Pay rent on the first of November', [t('Pay rent', { due: '2026-11-01' })]],
		['Submit the form by October twentieth', [t('Submit the form', { due: '2026-10-20' })]],
		[
			'Stand-up every weekday at 9am',
			[t('Stand-up', { due: '2026-10-15 09:00', recurrence: { interval: 1, unit: 'weekday' } })],
		],
		[
			'Take out the bins every Monday and Thursday',
			[t('Take out the bins', { due: '2026-10-15', recurrence: { interval: 1, unit: 'week', days: [1, 4] } })],
		],
		['Review the budget at the end of the day', [t('Review the budget', { due: '2026-10-14 17:00' })]],
		['Call Grandma this Sunday', [t('Call Grandma', { due: '2026-10-18' })]],
		['Renew the lease in three months', [t('Renew the lease', { due: '2027-01-14' })]],
		[
			'Water the plants every three days',
			[t('Water the plants', { due: '2026-10-14', recurrence: { interval: 3, unit: 'day' } })],
		],
		['Call the bank tomorrow morning', [t('Call the bank', { due: '2026-10-15' })]],
		['Dinner with the Lees on Saturday at 7:30pm', [t('Dinner with the Lees', { due: '2026-10-17 19:30' })]],
		['Send the report the day after tomorrow', [t('Send the report', { due: '2026-10-16' })]],
		['Meeting prep in an hour', [t('Meeting prep', { due: '2026-10-14 11:00' })]],
		['Pay the water bill next week', [t('Pay the water bill', { due: '2026-10-19' })]],
		[
			'Call the vet at 4pm remind me at 3pm',
			[t('Call the vet', { due: '2026-10-14 16:00', reminders: [at('2026-10-14', '15:00')] })],
		],
		['Car inspection on October 30th at 10am', [t('Car inspection', { due: '2026-10-30 10:00' })]],
		['Go running every morning', plain('Go running every morning')],
		[
			'Monthly review every month on the 1st',
			[t('Monthly review', { due: '2026-11-01', recurrence: { interval: 1, unit: 'month' } })],
		],
		['Call Mom on her birthday March 3rd', [t('Call Mom on her birthday', { due: '2027-03-03' })]],
		['Clean the fridge this evening', [t('Clean the fridge', { due: '2026-10-14 20:00' })]],
		[
			'Book the flights by Friday, remind me tomorrow at 9am',
			[t('Book the flights', { due: '2026-10-16', reminders: [at('2026-10-15', '09:00')] })],
		],
		['Pick up the kids at three thirty pm', [t('Pick up the kids', { due: '2026-10-14 15:30' })]],
		['Yoga every Tuesday at 6pm', [t('Yoga', { due: '2026-10-20 18:00', recurrence: weekly })]],
		['Pay the credit card on the 15th', [t('Pay the credit card', { due: '2026-10-15' })]],
		['Call Dad in ten minutes', [t('Call Dad', { due: '2026-10-14 10:10' })]],
		['Dentist next Tuesday at 2:15pm', [t('Dentist', { due: '2026-10-20 14:15' })]],
		['Remind me to call Ben at 5pm', [t('Call Ben', { due: '2026-10-14 17:00' })]],
		[
			'Team call tomorrow at 11am, remind me an hour before',
			[t('Team call', { due: '2026-10-15 11:00', reminders: [before(60)] })],
		],
		[
			'Water the lawn every other day',
			[t('Water the lawn', { due: '2026-10-14', recurrence: { interval: 2, unit: 'day' } })],
		],
	],
};

const slug = (text: string) =>
	text
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '')
		.slice(0, 48);

function handWritten(): RambleCase[] {
	const cases: RambleCase[] = [];
	for (const [category, rows] of Object.entries(HAND_WRITTEN) as Array<[Category, Row[]]>) {
		for (const [transcript, expected, extra] of rows) {
			cases.push({ id: `${category}-${slug(transcript)}`, category, transcript, expected, ...extra });
		}
	}
	return cases;
}

export const CORPUS: readonly RambleCase[] = [...handWritten(), ...generateCases()];

/**
 * Cases still measured rather than asserted. Remove an id once its case passes.
 * `call the plumber and ask…` is one errand to a person, and the grammar reads the second verb as
 * another task. It is the natural-segmentation gap; everything else in the corpus is locked.
 */
export const SCORED: ReadonlySet<string> = new Set<string>([
	'natural-call-the-plumber-tomorrow-morning-and-ask-about-',
]);
