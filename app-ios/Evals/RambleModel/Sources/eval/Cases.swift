struct Expected { let title: String; var subtasks: [String] = [] }
struct Case { let text: String; let tasks: [Expected] }

let cases: [Case] = [
    // Clean speech the grammar already handles.
    Case(text: "Buy milk. Call the plumber about the leak.", tasks: [.init(title: "buy milk"), .init(title: "call the plumber about the leak")]),
    Case(text: "call mom tomorrow at 5pm and then email the landlord about the heater", tasks: [.init(title: "call mom"), .init(title: "email the landlord about the heater")]),
    Case(text: "pay the electricity bill on friday priority 1", tasks: [.init(title: "pay the electricity bill")]),
    Case(text: "book a haircut next week, renew my passport, and pick up the dry cleaning tomorrow", tasks: [.init(title: "book a haircut"), .init(title: "renew my passport"), .init(title: "pick up the dry cleaning")]),
    Case(text: "file taxes with subtasks gather receipts, download the 1099 and book the accountant", tasks: [.init(title: "file taxes", subtasks: ["gather receipts", "download the 1099", "book the accountant"])]),
    Case(text: "buy salt and pepper and call the bank", tasks: [.init(title: "buy salt and pepper"), .init(title: "call the bank")]),
    Case(text: "next task water the plants every monday. next task call grandma on sunday", tasks: [.init(title: "water the plants"), .init(title: "call grandma")]),
    Case(text: "I need to fix the bike and clean the garage this weekend", tasks: [.init(title: "fix the bike"), .init(title: "clean the garage")]),
    Case(text: "Send the invoice to Acme in the work project", tasks: [.init(title: "send the invoice to acme")]),
    Case(text: "remind me to stretch every day at 8am", tasks: [.init(title: "stretch")]),
    // Implicit lists of items under a task.
    Case(text: "buy groceries for the party, milk, eggs and bread", tasks: [.init(title: "buy groceries for the party", subtasks: ["milk", "eggs", "bread"])]),
    Case(text: "pack for the trip: passport, charger, sunscreen and the camera", tasks: [.init(title: "pack for the trip", subtasks: ["passport", "charger", "sunscreen", "the camera"])]),
    Case(text: "get stuff from the hardware store, screws, a drill bit and some wood glue, and then call Dave", tasks: [.init(title: "get stuff from the hardware store", subtasks: ["screws", "a drill bit", "some wood glue"]), .init(title: "call dave")]),
    Case(text: "um I need to call the plumber tomorrow morning and also buy groceries for the party, milk, eggs and bread, oh and pay rent on friday", tasks: [.init(title: "call the plumber"), .init(title: "buy groceries for the party", subtasks: ["milk", "eggs", "bread"]), .init(title: "pay rent")]),
    // Steps introduced in other ways.
    Case(text: "plan the trip to Lisbon, the steps are book flights, find a hotel, and rent a car", tasks: [.init(title: "plan the trip to lisbon", subtasks: ["book flights", "find a hotel", "rent a car"])]),
    Case(text: "prepare the presentation, first make the outline, then the slides, then rehearse it twice", tasks: [.init(title: "prepare the presentation", subtasks: ["make the outline", "the slides", "rehearse it twice"])]),
    Case(text: "clean the apartment which means vacuum, mop the kitchen and take out the recycling", tasks: [.init(title: "clean the apartment", subtasks: ["vacuum", "mop the kitchen", "take out the recycling"])]),
    Case(text: "set up the new laptop, I need to install Xcode and copy my dotfiles and sign into iCloud", tasks: [.init(title: "set up the new laptop", subtasks: ["install xcode", "copy my dotfiles", "sign into icloud"])]),
    // Corrections.
    Case(text: "email Sarah about the deck on Thursday actually make that Friday", tasks: [.init(title: "email sarah about the deck")]),
    Case(text: "water the plants every Monday and Thursday, scratch that, every Monday. Also call mom", tasks: [.init(title: "water the plants"), .init(title: "call mom")]),
    Case(text: "pick up a prescription today, no wait, tomorrow, and text Dan the address", tasks: [.init(title: "pick up a prescription"), .init(title: "text dan the address")]),
    Case(text: "buy a gift for Anna, scratch that, call Anna instead", tasks: [.init(title: "call anna instead")]),
    Case(text: "renew the car insurance on the 20th, I mean the 21st", tasks: [.init(title: "renew the car insurance")]),
    // Rambling, fillers, run-ons.
    Case(text: "so tomorrow I gotta pick up the dry cleaning then swing by the bank to deposit the check and then I should probably book a dentist appointment for next week", tasks: [.init(title: "pick up the dry cleaning"), .init(title: "swing by the bank to deposit the check"), .init(title: "book a dentist appointment")]),
    Case(text: "okay so uh the thing is I really need to finally sort out the gutters before it rains and maybe also look at the fence", tasks: [.init(title: "sort out the gutters before it rains"), .init(title: "look at the fence")]),
    Case(text: "Finish the report for work by Monday at 9am, it needs the Q3 numbers and the charts from Lena", tasks: [.init(title: "finish the report for work", subtasks: ["the q3 numbers", "the charts from lena"])]),
    Case(text: "organize the birthday party, invite people, order a cake and decorate, and separately call the vet about Milo", tasks: [.init(title: "organize the birthday party", subtasks: ["invite people", "order a cake", "decorate"]), .init(title: "call the vet about milo")]),
    Case(text: "write the blog post about ramble, then review Tom's PR, then go for a run", tasks: [.init(title: "write the blog post about ramble"), .init(title: "review tom's pr"), .init(title: "go for a run")]),
    Case(text: "for the move I need to cancel internet, forward the mail and book movers", tasks: [.init(title: "the move", subtasks: ["cancel internet", "forward the mail", "book movers"])]),
    Case(text: "call the bank. Actually also ask them about the mortgage rate", tasks: [.init(title: "call the bank", subtasks: ["ask them about the mortgage rate"])]),
]
